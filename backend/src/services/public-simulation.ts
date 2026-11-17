// Versão pública de uma simulação: ordens de grandeza por escalões fixos, sem pesos,
// pisos, preços nem prazos.
//
// Os escalões são fixos (e não uma margem à volta do valor exato) de propósito: com uma
// margem simétrica, quem fizesse pedidos em série recuperava os pesos exatos pelo ponto
// médio. Assim só se fica a saber em que escalão cai cada combinação.

import type { PublicSimulation } from '../models/api.types.js';
import { divRoundHalfUp, toCents } from '../utils/currency.js';
import { describeSources, type Catalog, type StressTestInput } from './requirements.js';
import type { StressTestResult } from './stress-test-calculator.service.js';

/** Largura dos escalões da exposição comercial, em pontos percentuais da base exposta. */
export const PUBLIC_EXPOSURE_STEP = 20;
/** Largura dos escalões do agravamento de spread, em pontos base. */
export const PUBLIC_SPREAD_STEP_BPS = 25;

const euros = (cents: bigint, numerator: number, denominator: bigint) =>
  Number(divRoundHalfUp(cents * BigInt(numerator), denominator * 100n));

export function toPublicSimulation(
  input: StressTestInput,
  result: StressTestResult,
  catalog: Catalog,
): PublicSimulation {
  const exposedCents = toCents(result.exposedClientRevenue);

  let commercialRisk: PublicSimulation['commercialRisk'] = null;
  if (result.riskScore > 0) {
    const bucket = Math.ceil(result.riskScore / PUBLIC_EXPOSURE_STEP);
    const lowShare = (bucket - 1) * PUBLIC_EXPOSURE_STEP;
    const highShare = bucket * PUBLIC_EXPOSURE_STEP;
    commercialRisk = {
      lowShare,
      highShare,
      low: euros(exposedCents, lowShare, 100n),
      high: euros(exposedCents, highShare, 100n),
    };
  }

  let spreadPenalty: PublicSimulation['spreadPenalty'] = null;
  if (result.estimatedSpreadPenalty > 0) {
    const bucket = Math.floor(catalog.spreadPenaltyBps / PUBLIC_SPREAD_STEP_BPS);
    const lowBps = bucket * PUBLIC_SPREAD_STEP_BPS;
    const highBps = lowBps + PUBLIC_SPREAD_STEP_BPS;
    const creditCents = toCents(input.creditLineToRefinance);
    spreadPenalty = {
      lowBps,
      highBps,
      low: euros(creditCents, lowBps, 10_000n),
      high: euros(creditCents, highBps, 10_000n),
    };
  }

  return {
    access: 'public',
    engineVersion: result.catalogVersion,
    sectorProfile: result.sectorProfile,
    exposedClientRevenue: result.exposedClientRevenue,
    commercialRisk,
    spreadPenalty,
    gapCount: result.gaps.length,
    criticalGapCount: result.criticalGapCount,
    sectorBlocker: result.dealbreaker?.reason ?? null,
    gaps: result.gaps.map(({ requirement, task }) => ({
      code: requirement.code,
      label: requirement.label,
      requiredByLabel: describeSources(requirement.requiredBy),
      solutionTitle: task.title,
      phase: task.phase,
      executorType: task.executorType,
      critical: task.priority === 'critical',
    })),
  };
}
