import { describe, expect, it } from 'vitest';
import type { SectorProfile } from '../../src/models/domain.js';
import type { StressTestInput } from '../../src/services/requirements.catalog.js';
import {
  MAX_MONEY_AMOUNT,
  StressTestCalculatorService,
} from '../../src/services/stress-test-calculator.service.js';

const calculator = new StressTestCalculatorService();

// F_top = 6.500.000 × 62% = 4.030.000 €
const FULLY_COMPLIANT: StressTestInput = {
  sectorProfile: 'general_industrial',
  annualRevenue: 6_500_000,
  topClientsShare: 62,
  creditLineToRefinance: 3_000_000,
  ecovadis: true,
  carbonFootprintScope12: true,
  carbonFootprintScope3: true,
  bankingEsgMetrics: true,
  tisaxOrNis2: true,
};

const NOTHING_IN_PLACE: StressTestInput = {
  ...FULLY_COMPLIANT,
  ecovadis: false,
  carbonFootprintScope12: false,
  carbonFootprintScope3: false,
  bankingEsgMetrics: false,
  tisaxOrNis2: false,
};

const onlyMissing = (sector: SectorProfile, patch: Partial<StressTestInput>): StressTestInput => ({
  ...FULLY_COMPLIANT,
  sectorProfile: sector,
  ...patch,
});

describe('cenários-limite', () => {
  it('fábrica 100% conforme: score 0, nada em risco, orçamento vazio', () => {
    const result = calculator.calculate(FULLY_COMPLIANT);

    expect(result.exposedClientRevenue).toBe(4_030_000);
    expect(result.riskScore).toBe(0);
    expect(result.commercialRevenueAtRisk).toBe(0);
    expect(result.estimatedSpreadPenalty).toBe(0);
    expect(result.gaps).toEqual([]);
    expect(result.dealbreaker).toBeNull();
    expect(result.remediationSummary).toEqual({
      phase1Cost: 0,
      phase2Cost: 0,
      totalInvestment: 0,
      protectionRatio: 0,
      phase1CostShareOfRisk: null,
    });
  });

  it('fábrica sem nenhuma certificação (setor geral, 3M € a refinanciar)', () => {
    const result = calculator.calculate(NOTHING_IN_PLACE);

    // W_comm = 0,35 + 0,30 + 0,20 + 0,15 = 1,00. A banca não entra aqui.
    expect(result.commercialGapPoints).toBe(100);
    expect(result.riskScore).toBe(100);
    expect(result.commercialRevenueAtRisk).toBe(4_030_000);
    expect(result.commercialRevenueAtRiskShare).toBe(62);
    // 3.000.000 × 0,40% = 12.000 €/ano, em métrica separada.
    expect(result.estimatedSpreadPenalty).toBe(12_000);
    expect(result.gaps.map((g) => g.rule.code)).toEqual([
      'ecovadis',
      'carbon_scope_1_2',
      'carbon_scope_3',
      'banking_esg',
      'information_security',
    ]);
    expect(result.criticalGapCount).toBe(2);
    expect(result.remediationSummary).toEqual({
      phase1Cost: 7_700, // EcoVadis 3.500 + Âmbitos 1-2 2.400 + Banca 1.800
      phase2Cost: 8_300, // Âmbito 3 3.800 + TISAX/NIS2 4.500
      totalInvestment: 16_000,
      protectionRatio: 252.63, // (4.030.000 + 12.000) / 16.000
      phase1CostShareOfRisk: 0.19, // 7.700 / 4.030.000
    });
  });

  it('fábrica de moldes automóvel sem nada: W = 1,40, limitado a 1,0', () => {
    const result = calculator.calculate({ ...NOTHING_IN_PLACE, sectorProfile: 'automotive_molds' });

    expect(result.commercialGapPoints).toBe(140); // 45 + 30 + 30 + 35
    expect(result.riskScore).toBe(100);
    expect(result.commercialRevenueAtRisk).toBe(4_030_000);
    // O piso aplica-se, mas a soma já estava acima.
    expect(result.dealbreaker?.raisedWeight).toBe(false);
    expect(result.criticalGapCount).toBe(3); // EcoVadis, Âmbitos 1-2, TISAX
  });
});

describe('separação entre risco comercial e risco bancário', () => {
  it('só falta o dossier bancário: faturação comercial em risco é 0', () => {
    const result = calculator.calculate({
      ...FULLY_COMPLIANT,
      bankingEsgMetrics: false,
      creditLineToRefinance: 2_500_000,
    });

    expect(result.riskScore).toBe(0);
    expect(result.commercialRevenueAtRisk).toBe(0);
    expect(result.estimatedSpreadPenalty).toBe(10_000);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]?.task).toMatchObject({
      title: 'Dossier de Sustentabilidade para Indexação de Spread Bancário',
      phase: 'phase_1_urgent',
      estimatedCost: 1800,
      deadlineDays: 30,
      executorType: 'p4s',
    });
    expect(result.remediationSummary.protectionRatio).toBe(5.56); // 10.000 / 1.800
    expect(result.remediationSummary.phase1CostShareOfRisk).toBeNull();
  });

  it('sem crédito a refinanciar, a falta de rácios ESG não conta', () => {
    const result = calculator.calculate({ ...NOTHING_IN_PLACE, creditLineToRefinance: 0 });

    expect(result.estimatedSpreadPenalty).toBe(0);
    expect(result.evaluations.find((e) => e.rule.code === 'banking_esg')?.status).toBe('not_applicable');
    expect(result.gaps.map((g) => g.rule.code)).not.toContain('banking_esg');
    expect(result.commercialRevenueAtRisk).toBe(4_030_000);
  });

  it('com rácios ESG não há penalização, mesmo com crédito a refinanciar', () => {
    const result = calculator.calculate({ ...NOTHING_IN_PLACE, bankingEsgMetrics: true });
    expect(result.estimatedSpreadPenalty).toBe(0);
  });

  it.each([
    [125, 1], // 0,50 € → 1 €
    [375, 2], // 1,50 € → 2 €
    [1_234_567.89, 4_938],
    [MAX_MONEY_AMOUNT, 40_000_000_000],
  ])('spread de 40 bps sobre %d € = %d €/ano', (credit, penalty) => {
    const result = calculator.calculate({
      ...FULLY_COMPLIANT,
      bankingEsgMetrics: false,
      creditLineToRefinance: credit,
    });
    expect(result.estimatedSpreadPenalty).toBe(penalty);
  });
});

describe('pesos setoriais', () => {
  // F_top = 1.000.000 × 60% = 600.000 €
  const base = { annualRevenue: 1_000_000, topClientsShare: 60 };

  it.each([
    // setor, lacuna, pontos, faturação em risco
    ['general_industrial', { ecovadis: false }, 35, 210_000],
    ['heavy_process', { ecovadis: false }, 35, 210_000],
    ['automotive_molds', { ecovadis: false }, 45, 270_000],
    ['agro_packaging', { ecovadis: false }, 65, 390_000], // 45, sobe ao piso agro de 65
    ['general_industrial', { carbonFootprintScope12: false }, 30, 180_000],
    ['general_industrial', { carbonFootprintScope3: false }, 20, 120_000],
    ['agro_packaging', { carbonFootprintScope3: false }, 20, 120_000],
    ['automotive_molds', { carbonFootprintScope3: false }, 30, 180_000],
    ['general_industrial', { tisaxOrNis2: false }, 15, 90_000],
    ['agro_packaging', { tisaxOrNis2: false }, 15, 90_000],
  ] as const)('%s, %o → %d pontos', (sector, patch, points, atRisk) => {
    const result = calculator.calculate(onlyMissing(sector, { ...base, ...patch }));
    expect(result.riskScore).toBe(points);
    expect(result.commercialRevenueAtRisk).toBe(atRisk);
  });

  it('TISAX/NIS2 é crítico e Fase 1 só em moldes automóvel', () => {
    const automotive = calculator.calculate(onlyMissing('automotive_molds', { tisaxOrNis2: false }));
    const general = calculator.calculate(onlyMissing('general_industrial', { tisaxOrNis2: false }));

    expect(automotive.gaps[0]?.task).toMatchObject({ priority: 'critical', phase: 'phase_1_urgent' });
    expect(automotive.gaps[0]?.weightPoints).toBe(35);
    expect(general.gaps[0]?.task).toMatchObject({ priority: 'high', phase: 'phase_2_structural' });
    expect(general.gaps[0]?.weightPoints).toBe(15);
    for (const result of [automotive, general]) {
      expect(result.gaps[0]?.task).toMatchObject({ executorType: 'partner', estimatedCost: 4500, deadlineDays: 75 });
    }
  });
});

describe('pisos de dealbreaker setorial', () => {
  const base = { annualRevenue: 1_000_000, topClientsShare: 60 };

  it('moldes automóvel sem TISAX/NIS2: 35 pontos sobem ao piso de 75', () => {
    const result = calculator.calculate(onlyMissing('automotive_molds', { ...base, tisaxOrNis2: false }));

    expect(result.commercialGapPoints).toBe(35);
    expect(result.commercialRiskPoints).toBe(75);
    expect(result.riskScore).toBe(75);
    expect(result.commercialRevenueAtRisk).toBe(450_000);
    expect(result.dealbreaker).toMatchObject({
      sector: 'automotive_molds',
      floorPoints: 75,
      triggeredBy: ['information_security'],
      raisedWeight: true,
    });
  });

  it('moldes automóvel sem pegada de âmbitos 1 e 2: 30 pontos sobem a 75', () => {
    const result = calculator.calculate(onlyMissing('automotive_molds', { ...base, carbonFootprintScope12: false }));
    expect(result.riskScore).toBe(75);
    expect(result.dealbreaker?.triggeredBy).toEqual(['carbon_scope_1_2']);
  });

  it('moldes automóvel só sem EcoVadis ou âmbito 3: sem piso', () => {
    expect(calculator.calculate(onlyMissing('automotive_molds', { ecovadis: false })).dealbreaker).toBeNull();
    expect(calculator.calculate(onlyMissing('automotive_molds', { carbonFootprintScope3: false })).dealbreaker).toBeNull();
  });

  it('embalagem agroalimentar sem pegada de âmbitos 1 e 2: 30 pontos sobem a 65', () => {
    const result = calculator.calculate(onlyMissing('agro_packaging', { ...base, carbonFootprintScope12: false }));
    expect(result.riskScore).toBe(65);
    expect(result.commercialRevenueAtRisk).toBe(390_000);
    expect(result.dealbreaker).toMatchObject({ floorPoints: 65, raisedWeight: true });
  });

  it('embalagem agroalimentar só sem TISAX/NIS2: sem piso', () => {
    const result = calculator.calculate(onlyMissing('agro_packaging', { tisaxOrNis2: false }));
    expect(result.dealbreaker).toBeNull();
    expect(result.riskScore).toBe(15);
  });

  it('setores sem dealbreaker não têm piso', () => {
    for (const sector of ['general_industrial', 'heavy_process'] as const) {
      const result = calculator.calculate(onlyMissing(sector, { tisaxOrNis2: false, carbonFootprintScope12: false }));
      expect(result.dealbreaker).toBeNull();
      expect(result.riskScore).toBe(45);
    }
  });

  it('a penalização bancária não aciona nem altera o piso', () => {
    const result = calculator.calculate(onlyMissing('automotive_molds', { ...base, bankingEsgMetrics: false }));
    expect(result.dealbreaker).toBeNull();
    expect(result.riskScore).toBe(0);
    expect(result.estimatedSpreadPenalty).toBe(12_000);
  });
});

describe('aritmética', () => {
  it('arredonda meio-para-cima sem erro de vírgula flutuante', () => {
    // F_top = 90 €, W = 0,20 + 0,15 = 0,35 → 31,5 € → 32 €. Em float daria 31 €.
    const result = calculator.calculate(
      onlyMissing('general_industrial', {
        annualRevenue: 90,
        topClientsShare: 100,
        carbonFootprintScope3: false,
        tisaxOrNis2: false,
      }),
    );
    expect(result.riskScore).toBe(35);
    expect(result.commercialRevenueAtRisk).toBe(32);
  });

  it('aceita concentração com casas decimais', () => {
    const result = calculator.calculate(
      onlyMissing('general_industrial', { annualRevenue: 1_000_000, topClientsShare: 33.33, ecovadis: false }),
    );
    expect(result.exposedClientRevenue).toBe(333_300);
    expect(result.commercialRevenueAtRisk).toBe(116_655); // 333.300 × 0,35
  });

  it('concentração 0%: nada em risco, mas o score reflete as lacunas', () => {
    const result = calculator.calculate({ ...NOTHING_IN_PLACE, topClientsShare: 0 });
    expect(result.commercialRevenueAtRisk).toBe(0);
    expect(result.riskScore).toBe(100);
    expect(result.remediationSummary.phase1CostShareOfRisk).toBeNull();
  });

  it('mantém precisão no limite de NUMERIC(15, 2)', () => {
    const result = calculator.calculate({
      ...NOTHING_IN_PLACE,
      annualRevenue: MAX_MONEY_AMOUNT,
      topClientsShare: 100,
    });
    expect(result.exposedClientRevenue).toBe(MAX_MONEY_AMOUNT);
    expect(result.commercialRevenueAtRisk).toBe(10_000_000_000_000);
  });
});

describe('validação', () => {
  it.each([
    ['faturação negativa', { annualRevenue: -1 }],
    ['faturação NaN', { annualRevenue: Number.NaN }],
    ['faturação acima do limite', { annualRevenue: MAX_MONEY_AMOUNT + 1 }],
    ['crédito negativo', { creditLineToRefinance: -10 }],
    ['concentração acima de 100%', { topClientsShare: 100.01 }],
    ['concentração negativa', { topClientsShare: -0.5 }],
  ] as const)('rejeita %s', (_label, patch) => {
    expect(() => calculator.calculate({ ...FULLY_COMPLIANT, ...patch })).toThrow();
  });

  it('rejeita setor desconhecido', () => {
    const input = { ...FULLY_COMPLIANT, sectorProfile: 'textil' } as unknown as StressTestInput;
    expect(() => calculator.calculate(input)).toThrow(RangeError);
  });

  it('rejeita respostas não booleanas', () => {
    const input = { ...FULLY_COMPLIANT, ecovadis: 'sim' } as unknown as StressTestInput;
    expect(() => calculator.calculate(input)).toThrow(TypeError);
  });
});
