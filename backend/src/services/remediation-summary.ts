// Orçamento faseado e rácio de proteção. Função pura usada pelo motor, pela API
// (plano guardado) e pelo configurador de proposta no frontend, para que o número
// mostrado na reunião seja sempre o mesmo que fica gravado.

import type { TaskExecutor, TaskPhase } from '../models/domain.js';
import { toCents } from '../utils/currency.js';

export interface ProposalLine {
  phase: TaskPhase;
  executorType: TaskExecutor;
  estimatedCost: number;
  includedInProposal: boolean;
}

export interface RemediationSummary {
  /** Honorários P4S + parceiro na Fase 1 (€). */
  phase1Cost: number;
  /** Honorários P4S + parceiro na Fase 2 (€). */
  phase2Cost: number;
  totalInvestment: number;
  /** (faturação comercial em risco + penalização de spread) / max(1, investimento total). */
  protectionRatio: number;
  /** Investimento da Fase 1 em % da faturação comercial em risco. Null se nada estiver em risco. */
  phase1CostShareOfRisk: number | null;
}

/** Conta para o orçamento: incluído na proposta e executado pela P4S ou pelo parceiro. */
export function countsTowardsProposal(line: Pick<ProposalLine, 'executorType' | 'includedInProposal'>): boolean {
  return line.includedInProposal && line.executorType !== 'internal';
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function summarizeRemediation(
  lines: readonly ProposalLine[],
  commercialRevenueAtRisk: number,
  estimatedSpreadPenalty: number,
): RemediationSummary {
  let phase1Cents = 0n;
  let phase2Cents = 0n;
  for (const line of lines) {
    if (!countsTowardsProposal(line)) continue;
    if (line.phase === 'phase_1_urgent') phase1Cents += toCents(line.estimatedCost);
    else phase2Cents += toCents(line.estimatedCost);
  }

  const phase1Cost = Number(phase1Cents) / 100;
  const phase2Cost = Number(phase2Cents) / 100;
  const totalInvestment = Number(phase1Cents + phase2Cents) / 100;

  return {
    phase1Cost,
    phase2Cost,
    totalInvestment,
    protectionRatio: round2((commercialRevenueAtRisk + estimatedSpreadPenalty) / Math.max(1, totalInvestment)),
    phase1CostShareOfRisk:
      commercialRevenueAtRisk > 0 ? round2((phase1Cost / commercialRevenueAtRisk) * 100) : null,
  };
}
