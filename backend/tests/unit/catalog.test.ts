import { describe, expect, it } from 'vitest';
import { SECTOR_PROFILES } from '../../src/models/domain.js';
import { CATALOG } from '../../src/services/catalog.private.js';
import { toPublicSimulation, PUBLIC_EXPOSURE_STEP } from '../../src/services/public-simulation.js';
import {
  PHASE_WINDOWS,
  REQUIREMENTS,
  forSector,
  isWithinPhase,
  phaseWindowText,
  resolveTask,
  type StressTestInput,
} from '../../src/services/requirements.js';
import { StressTestCalculatorService } from '../../src/services/stress-test-calculator.service.js';

const calculator = new StressTestCalculatorService(CATALOG);

const NOTHING_IN_PLACE: StressTestInput = {
  sectorProfile: 'automotive_molds',
  annualRevenue: 6_500_000,
  topClientsShare: 62,
  creditLineToRefinance: 3_000_000,
  ecovadis: false,
  carbonFootprintScope12: false,
  carbonFootprintScope3: false,
  bankingEsgMetrics: false,
  tisaxOrNis2: false,
};

describe('catálogo: coerência interna', () => {
  it('todos os requisitos têm parâmetros e não há parâmetros a mais', () => {
    expect(Object.keys(CATALOG.parameters).sort()).toEqual(REQUIREMENTS.map((r) => r.code).sort());
  });

  it('as janelas das fases são contíguas e batem com o texto mostrado ao cliente', () => {
    expect(PHASE_WINDOWS.phase_1_urgent).toMatchObject({ afterDay: 0, untilDay: 60 });
    expect(PHASE_WINDOWS.phase_2_structural).toMatchObject({ afterDay: 60, untilDay: 120 });
    expect(phaseWindowText('phase_1_urgent')).toBe('0–60 dias');
    expect(phaseWindowText('phase_2_structural')).toBe('60–120 dias');
  });

  // A promessa comercial é «Fase 1: 0–60 dias». Uma tarefa-tipo com prazo fora da janela
  // da sua fase contradiz a proposta no próprio documento.
  it.each(SECTOR_PROFILES.flatMap((sector) => REQUIREMENTS.map((r) => [sector, r.code] as const)))(
    '%s / %s: o prazo da tarefa-tipo cabe na janela da sua fase',
    (sector, code) => {
      const task = resolveTask(CATALOG.parameters[code], sector);
      expect(
        isWithinPhase(task.phase, task.deadlineDays),
        `${task.deadlineDays} dias na ${PHASE_WINDOWS[task.phase].label} (${phaseWindowText(task.phase)})`,
      ).toBe(true);
    },
  );

  it('pesos inteiros entre 0 e 100, só os requisitos comerciais pesam', () => {
    for (const requirement of REQUIREMENTS) {
      for (const sector of SECTOR_PROFILES) {
        const weight = forSector(CATALOG.parameters[requirement.code].weightPoints, sector);
        expect(Number.isInteger(weight)).toBe(true);
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(100);
        if (requirement.channel === 'financial') expect(weight).toBe(0);
        else expect(weight).toBeGreaterThan(0);
      }
    }
  });

  it('honorários positivos e executores do âmbito fechado', () => {
    for (const requirement of REQUIREMENTS) {
      const { task } = CATALOG.parameters[requirement.code];
      expect(task.estimatedCost).toBeGreaterThan(0);
      expect(task.executorType).toBe(requirement.code === 'information_security' ? 'partner' : 'p4s');
      expect(requirement.requiredBy.length).toBeGreaterThan(0);
    }
  });

  it('os bloqueios setoriais referem setores e requisitos que existem', () => {
    const codes = REQUIREMENTS.map((r) => r.code);
    for (const rule of CATALOG.dealbreakers) {
      expect(SECTOR_PROFILES).toContain(rule.sector);
      expect(rule.floorPoints).toBeGreaterThan(0);
      expect(rule.floorPoints).toBeLessThanOrEqual(100);
      for (const trigger of rule.triggers) expect(codes).toContain(trigger);
    }
    expect(new Set(CATALOG.dealbreakers.map((d) => d.sector)).size).toBe(CATALOG.dealbreakers.length);
  });

  it('a parte pública do catálogo não tem números do modelo', () => {
    const publicPart = JSON.stringify(REQUIREMENTS);
    expect(publicPart).not.toMatch(/weight|cost|deadline|floor|bps/i);
  });

  // Estas frases só existem no catálogo privado. O frontend verifica que não aparecem
  // no código público (frontend/scripts/check-bundle.mjs): se mudarem aqui, mudam lá.
  it('as frases-sentinela da verificação do bundle existem no catálogo privado', () => {
    const privatePart = JSON.stringify(CATALOG);
    for (const sentinel of ['quatro temas EcoVadis', 'Indexação de Spread Bancário', 'fora de novos RFQ']) {
      expect(privatePart).toContain(sentinel);
    }
  });
});

function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
  return [];
}

describe('simulação pública: ordens de grandeza, sem pesos nem preços', () => {
  const simulate = (input: StressTestInput) => toPublicSimulation(input, calculator.calculate(input), CATALOG);

  it('não leva pesos, pisos, preços, prazos nem valores exatos', () => {
    // Caso não saturado (score 35): com score 100 o limite do escalão coincide com a base exposta.
    const input: StressTestInput = {
      ...NOTHING_IN_PLACE,
      sectorProfile: 'general_industrial',
      carbonFootprintScope12: true,
      carbonFootprintScope3: true,
      tisaxOrNis2: true,
    };
    const exact = calculator.calculate(input);
    const publicView = simulate(input);
    const text = JSON.stringify(publicView);
    expect(exact.gaps.map((g) => g.requirement.code)).toEqual(['ecovadis', 'banking_esg']);

    expect(text).not.toMatch(/weightPoints|floorPoints|estimatedCost|deadline|remediationSummary|riskScore/);
    expect(publicView).not.toHaveProperty('commercialRevenueAtRisk');
    expect(publicView).not.toHaveProperty('estimatedSpreadPenalty');

    // Nenhum número da resposta é um preço nem um valor exato do cálculo.
    const numbers = numbersIn(publicView);
    for (const { task } of exact.gaps) expect(numbers).not.toContain(task.estimatedCost);
    expect(numbers).not.toContain(exact.commercialRevenueAtRisk);
    expect(numbers).not.toContain(exact.estimatedSpreadPenalty);
    expect(numbers).not.toContain(exact.riskScore);
  });

  it('a exposição comercial vem num escalão fixo de 20 pontos que contém o valor exato', () => {
    // Setor geral, só sem EcoVadis: W = 0,35 → escalão 20–40% da base exposta.
    const input: StressTestInput = {
      ...NOTHING_IN_PLACE,
      sectorProfile: 'general_industrial',
      annualRevenue: 1_000_000,
      topClientsShare: 60,
      carbonFootprintScope12: true,
      carbonFootprintScope3: true,
      bankingEsgMetrics: true,
      tisaxOrNis2: true,
    };
    const exact = calculator.calculate(input);
    expect(simulate(input).commercialRisk).toEqual({ lowShare: 20, highShare: 40, low: 120_000, high: 240_000 });
    expect(exact.commercialRevenueAtRisk).toBeGreaterThan(120_000);
    expect(exact.commercialRevenueAtRisk).toBeLessThanOrEqual(240_000);
  });

  it.each([
    [1, 0, 20],
    [20, 0, 20],
    [21, 20, 40],
    [65, 60, 80],
    [75, 60, 80],
    [100, 80, 100],
  ])('score %d cai no escalão %d–%d%%', (score, lowShare, highShare) => {
    const bucket = Math.ceil(score / PUBLIC_EXPOSURE_STEP);
    expect([(bucket - 1) * PUBLIC_EXPOSURE_STEP, bucket * PUBLIC_EXPOSURE_STEP]).toEqual([lowShare, highShare]);
  });

  it('pesos diferentes no mesmo escalão dão a mesma resposta pública', () => {
    // 0,65 (piso agro) e 0,75 (piso automóvel) caem ambos em 60–80%.
    const base = { ...NOTHING_IN_PLACE, ecovadis: true, carbonFootprintScope3: true, bankingEsgMetrics: true, tisaxOrNis2: true };
    const agro = simulate({ ...base, sectorProfile: 'agro_packaging' });
    const automotive = simulate({ ...base, sectorProfile: 'automotive_molds' });
    expect(agro.commercialRisk).toEqual(automotive.commercialRisk);
  });

  it('o sobrecusto bancário vem num escalão de pontos base que contém o valor exato', () => {
    const publicView = simulate(NOTHING_IN_PLACE);
    // 40 bps cai em 25–50 bps: 3.000.000 × 0,25% e × 0,50%.
    expect(publicView.spreadPenalty).toEqual({ lowBps: 25, highBps: 50, low: 7_500, high: 15_000 });
  });

  it('sem lacunas não há escalões nem bloqueio', () => {
    const publicView = simulate({
      ...NOTHING_IN_PLACE,
      ecovadis: true,
      carbonFootprintScope12: true,
      carbonFootprintScope3: true,
      bankingEsgMetrics: true,
      tisaxOrNis2: true,
    });
    expect(publicView).toMatchObject({ commercialRisk: null, spreadPenalty: null, gapCount: 0, sectorBlocker: null, gaps: [] });
  });

  it('mostra o que falta e quem exige, com o título do entregável', () => {
    const publicView = simulate(NOTHING_IN_PLACE);
    expect(publicView.gapCount).toBe(5);
    expect(publicView.criticalGapCount).toBe(3);
    expect(publicView.sectorBlocker).toMatch(/RFQ/);
    expect(publicView.gaps[0]).toEqual({
      code: 'ecovadis',
      label: 'EcoVadis',
      requiredByLabel: 'Cliente industrial',
      solutionTitle: 'Preparação e Submissão do Dossier EcoVadis',
      phase: 'phase_1_urgent',
      executorType: 'p4s',
      critical: true,
    });
  });
});
