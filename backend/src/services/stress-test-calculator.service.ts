// Motor de cálculo do stress test. Função pura, sem I/O, partilhada com o frontend.
// Devolve três métricas independentes, que nunca se somam entre si.
//
// 1. Faturação comercial em risco (€)
//      F_top   = annualRevenue × topClientsShare / 100
//      W_comm  = soma dos pesos setoriais das lacunas comerciais
//                (com piso de dealbreaker em moldes automóvel e embalagem agroalimentar)
//      riskScore               = min(100, W_comm × 100)
//      commercialRevenueAtRisk = round(F_top × min(1, W_comm))
//
// 2. Sobrecusto bancário anual (€/ano)
//      se !bankingEsgMetrics e creditLineToRefinance > 0:
//      estimatedSpreadPenalty = round(creditLineToRefinance × 0,0040)
//
// 3. Orçamento faseado e rácio de proteção (remediationSummary)
//
// Os pesos são inteiros (pontos) e o dinheiro é tratado em cêntimos com BigInt, para que
// o mesmo input dê sempre o mesmo número. Em vírgula flutuante, 90 × (0,20 + 0,15) dá
// 31,499999999999996 e arredonda para 31 € em vez de 32 €.

import { SECTOR_PROFILES, type SectorProfile } from '../models/domain.js';
import { divRoundHalfUp, toCents } from '../utils/currency.js';
import {
  REQUIREMENT_CATALOG,
  SECTOR_DEALBREAKERS,
  SPREAD_PENALTY_BPS,
  evaluateRequirement,
  type RequirementRule,
  type RequirementStatus,
  type RequirementTaskTemplate,
  type SectorDealbreaker,
  type StressTestInput,
} from './requirements.catalog.js';
import { summarizeRemediation, type RemediationSummary } from './remediation-summary.js';

export const ENGINE_VERSION = '2.0.0';

/** Limite de NUMERIC(15, 2). */
export const MAX_MONEY_AMOUNT = 9_999_999_999_999.99;

const BOOLEAN_FIELDS = [
  'ecovadis',
  'carbonFootprintScope12',
  'carbonFootprintScope3',
  'bankingEsgMetrics',
  'tisaxOrNis2',
] as const satisfies readonly (keyof StressTestInput)[];

export interface RequirementEvaluation {
  rule: RequirementRule;
  status: RequirementStatus;
  /** Peso comercial já ajustado ao setor (0 nos requisitos financeiros). */
  weightPoints: number;
  task: RequirementTaskTemplate;
}

export interface AppliedDealbreaker extends SectorDealbreaker {
  /** Lacunas que acionaram o piso. */
  triggeredBy: RequirementRule['code'][];
  /** O piso subiu efetivamente o peso (a soma das lacunas estava abaixo). */
  raisedWeight: boolean;
}

export interface StressTestResult {
  sectorProfile: SectorProfile;
  /** F_top (€, com cêntimos). */
  exposedClientRevenue: number;
  /** Soma dos pesos das lacunas comerciais, antes de piso e limite. */
  commercialGapPoints: number;
  /** Peso comercial efetivo, depois do piso e antes do limite de 100. */
  commercialRiskPoints: number;
  dealbreaker: AppliedDealbreaker | null;
  riskScore: number;
  /** € inteiros. */
  commercialRevenueAtRisk: number;
  /** Faturação comercial em risco em % da faturação anual, 1 casa decimal. */
  commercialRevenueAtRiskShare: number;
  /** €/ano inteiros. */
  estimatedSpreadPenalty: number;
  evaluations: RequirementEvaluation[];
  gaps: RequirementEvaluation[];
  criticalGapCount: number;
  remediationSummary: RemediationSummary;
}

function assertMoney(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} tem de ser um número finito.`);
  }
  if (value < 0 || value > MAX_MONEY_AMOUNT) {
    throw new RangeError(`${name} tem de estar entre 0 e ${MAX_MONEY_AMOUNT}.`);
  }
}

export function assertValidStressTestInput(input: StressTestInput): void {
  if (!(SECTOR_PROFILES as readonly string[]).includes(input.sectorProfile)) {
    throw new RangeError(`sectorProfile inválido: ${String(input.sectorProfile)}`);
  }
  assertMoney('annualRevenue', input.annualRevenue);
  assertMoney('creditLineToRefinance', input.creditLineToRefinance);
  const { topClientsShare } = input;
  if (typeof topClientsShare !== 'number' || !Number.isFinite(topClientsShare)) {
    throw new TypeError('topClientsShare tem de ser um número finito.');
  }
  if (topClientsShare < 0 || topClientsShare > 100) {
    throw new RangeError('topClientsShare tem de estar entre 0 e 100.');
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof input[field] !== 'boolean') throw new TypeError(`${field} tem de ser booleano.`);
  }
}

export class StressTestCalculatorService {
  constructor(
    private readonly catalog: readonly RequirementRule[] = REQUIREMENT_CATALOG,
    private readonly dealbreakers: readonly SectorDealbreaker[] = SECTOR_DEALBREAKERS,
  ) {}

  calculate(input: StressTestInput): StressTestResult {
    assertValidStressTestInput(input);
    const sector = input.sectorProfile;

    const evaluations: RequirementEvaluation[] = this.catalog.map((rule) => {
      const resolved = rule.resolve(sector);
      return {
        rule,
        status: evaluateRequirement(rule, input),
        weightPoints: rule.channel === 'commercial' ? resolved.weightPoints : 0,
        task: resolved.task,
      };
    });
    const gaps = evaluations.filter((e) => e.status === 'gap');
    const gapCodes = gaps.map((e) => e.rule.code);

    // 1. Risco comercial
    const commercialGapPoints = gaps
      .filter((e) => e.rule.channel === 'commercial')
      .reduce((sum, e) => sum + e.weightPoints, 0);

    const dealbreaker = this.findDealbreaker(sector, gapCodes, commercialGapPoints);
    const commercialRiskPoints = dealbreaker
      ? Math.max(commercialGapPoints, dealbreaker.floorPoints)
      : commercialGapPoints;
    const cappedPoints = Math.min(100, commercialRiskPoints);

    const revenueCents = toCents(input.annualRevenue);
    // Percentagem com 2 casas decimais → pontos base (0–10000).
    const shareBasisPoints = BigInt(Math.round(input.topClientsShare * 100));
    const exposedCents = divRoundHalfUp(revenueCents * shareBasisPoints, 10_000n);
    // € = cêntimos × bp × pontos / (100 × 10000 × 100)
    const commercialRevenueAtRisk = Number(
      divRoundHalfUp(revenueCents * shareBasisPoints * BigInt(cappedPoints), 100_000_000n),
    );

    // 2. Risco bancário (independente)
    const bankingGap = gaps.some((e) => e.rule.channel === 'financial');
    // € = cêntimos × bps / (10000 × 100)
    const estimatedSpreadPenalty = bankingGap
      ? Number(divRoundHalfUp(toCents(input.creditLineToRefinance) * BigInt(SPREAD_PENALTY_BPS), 1_000_000n))
      : 0;

    // 3. Orçamento: todas as tarefas sugeridas entram na proposta
    const remediationSummary = summarizeRemediation(
      gaps.map((e) => ({
        phase: e.task.phase,
        executorType: e.task.executorType,
        estimatedCost: e.task.estimatedCost,
        includedInProposal: true,
      })),
      commercialRevenueAtRisk,
      estimatedSpreadPenalty,
    );

    return {
      sectorProfile: sector,
      exposedClientRevenue: Number(exposedCents) / 100,
      commercialGapPoints,
      commercialRiskPoints,
      dealbreaker,
      riskScore: cappedPoints,
      commercialRevenueAtRisk,
      commercialRevenueAtRiskShare:
        input.annualRevenue > 0
          ? Math.round((commercialRevenueAtRisk / input.annualRevenue) * 1000) / 10
          : 0,
      estimatedSpreadPenalty,
      evaluations,
      gaps,
      criticalGapCount: gaps.filter((e) => e.task.priority === 'critical').length,
      remediationSummary,
    };
  }

  private findDealbreaker(
    sector: SectorProfile,
    gapCodes: readonly RequirementRule['code'][],
    commercialGapPoints: number,
  ): AppliedDealbreaker | null {
    const rule = this.dealbreakers.find((d) => d.sector === sector);
    if (!rule) return null;
    const triggeredBy = rule.triggers.filter((code) => gapCodes.includes(code));
    if (triggeredBy.length === 0) return null;
    return { ...rule, triggeredBy, raisedWeight: commercialGapPoints < rule.floorPoints };
  }
}
