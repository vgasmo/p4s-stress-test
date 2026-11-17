import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../src/services/catalog.private.js';
import { describeSources, type StressTestInput } from '../../src/services/requirements.js';
import {
  StressTestCalculatorService,
  type RequirementEvaluation,
} from '../../src/services/stress-test-calculator.service.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';

const generator = new TaskGeneratorService();
const calculator = new StressTestCalculatorService(CATALOG);

const NOTHING_IN_PLACE: StressTestInput = {
  sectorProfile: 'general_industrial',
  annualRevenue: 6_500_000,
  topClientsShare: 62,
  creditLineToRefinance: 3_000_000,
  ecovadis: false,
  carbonFootprintScope12: false,
  carbonFootprintScope3: false,
  bankingEsgMetrics: false,
  tisaxOrNis2: false,
};

describe('TaskGeneratorService, as 5 tarefas-tipo', () => {
  const { gaps } = calculator.calculate(NOTHING_IN_PLACE);
  const tasks = generator.generate(gaps, '2026-11-17');

  it('gera uma tarefa por lacuna, com os valores da especificação', () => {
    expect(
      tasks.map(({ title, domain, priority, phase, executorType, estimatedCost, deadline }) => ({
        title,
        domain,
        priority,
        phase,
        executorType,
        estimatedCost,
        deadline,
      })),
    ).toEqual([
      {
        title: 'Preparação e Submissão do Dossier EcoVadis',
        domain: 'ecovadis',
        priority: 'critical',
        phase: 'phase_1_urgent',
        executorType: 'p4s',
        estimatedCost: 3500,
        deadline: '2027-01-16', // +60 dias
      },
      {
        title: 'Inventário de Emissões GEE (Âmbitos 1 e 2)',
        domain: 'carbon_footprint',
        priority: 'critical',
        phase: 'phase_1_urgent',
        executorType: 'p4s',
        estimatedCost: 2400,
        deadline: '2027-01-01', // +45 dias
      },
      {
        title: 'Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3)',
        domain: 'carbon_footprint',
        priority: 'high',
        phase: 'phase_2_structural',
        executorType: 'p4s',
        estimatedCost: 3800,
        deadline: '2027-02-15', // +90 dias
      },
      {
        title: 'Dossier de Sustentabilidade para Indexação de Spread Bancário',
        domain: 'banking_esg',
        priority: 'high',
        phase: 'phase_1_urgent',
        executorType: 'p4s',
        estimatedCost: 1800,
        deadline: '2026-12-17', // +30 dias
      },
      {
        title: 'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX',
        domain: 'information_security',
        priority: 'high',
        phase: 'phase_2_structural',
        executorType: 'partner',
        estimatedCost: 4500,
        deadline: '2027-01-31', // +75 dias
      },
    ]);
  });

  it('todas começam em backlog e incluídas na proposta', () => {
    expect(tasks.every((task) => task.status === 'backlog' && task.includedInProposal)).toBe(true);
  });

  it('cada tarefa tem remetente concreto, como campo e não como texto na descrição', () => {
    for (const task of tasks) {
      expect(task.requiredBy.length).toBeGreaterThan(0);
      expect(describeSources(task.requiredBy)).toMatch(/Cliente industrial|Banco/);
      expect(task.description).not.toMatch(/Exigido por/);
    }
    expect(tasks.find((t) => t.requirementCode === 'banking_esg')?.requiredBy).toEqual(['bank']);
    expect(tasks.find((t) => t.requirementCode === 'information_security')?.requiredBy).toEqual([
      'industrial_client',
      'nis2_if_in_scope',
    ]);
  });

  it('a NIS2 nunca aparece como obrigação certa', () => {
    const infosec = tasks.find((t) => t.requirementCode === 'information_security');
    expect(describeSources(infosec?.requiredBy ?? [])).toBe('Cliente industrial / NIS2 (se a empresa estiver abrangida)');
    expect(infosec?.description).toContain('A auditoria confirma se a empresa está abrangida pela NIS2');
    for (const task of tasks) expect(task.description).not.toMatch(/Diretiva NIS2|Lei NIS2|obrigação legal/i);
  });

  it('não gera serviços fora do âmbito fechado', () => {
    const outOfScope =
      /intelig[êe]ncia artificial|consultoria de ia|transforma[çc][ãa]o digital|otimiza[çc][ãa]o estrat[ée]gica/i;
    for (const task of tasks) expect(task.title).not.toMatch(outOfScope);
  });

  it('em moldes automóvel, TISAX/NIS2 passa a crítico, Fase 1 e 60 dias', () => {
    const automotive = calculator.calculate({ ...NOTHING_IN_PLACE, sectorProfile: 'automotive_molds' });
    const infosec = generator
      .generate(automotive.gaps, '2026-11-17')
      .find((t) => t.requirementCode === 'information_security');
    expect(infosec).toMatchObject({
      priority: 'critical',
      phase: 'phase_1_urgent',
      executorType: 'partner',
      deadline: '2027-01-16', // +60 dias
    });
  });
});

describe('TaskGeneratorService, casos-limite', () => {
  it('fábrica 100% conforme não gera tarefas', () => {
    const { gaps } = calculator.calculate({
      ...NOTHING_IN_PLACE,
      ecovadis: true,
      carbonFootprintScope12: true,
      carbonFootprintScope3: true,
      bankingEsgMetrics: true,
      tisaxOrNis2: true,
    });
    expect(generator.generate(gaps, '2026-11-17')).toEqual([]);
  });

  it('conta prazos em anos bissextos', () => {
    const { gaps } = calculator.calculate({
      ...NOTHING_IN_PLACE,
      ecovadis: true,
      carbonFootprintScope12: true,
      carbonFootprintScope3: true,
      tisaxOrNis2: true,
    });
    expect(generator.generate(gaps, '2028-02-01')[0]?.deadline).toBe('2028-03-02');
  });

  it('rejeita data base inválida', () => {
    expect(() => generator.generate([], '2026-02-30')).toThrow(RangeError);
    expect(() => generator.generate([], '17/11/2026')).toThrow(RangeError);
  });

  it('recusa requisitos sem remetente ou que não são lacuna', () => {
    const [first] = calculator.calculate(NOTHING_IN_PLACE).gaps;
    const gap = first as RequirementEvaluation;
    const orphan = { ...gap, requirement: { ...gap.requirement, requiredBy: [] } };
    expect(() => generator.generate([orphan], '2026-11-17')).toThrow(/remetente/);
    expect(() => generator.generate([{ ...gap, status: 'compliant' }], '2026-11-17')).toThrow(/não é uma lacuna/);
  });
});
