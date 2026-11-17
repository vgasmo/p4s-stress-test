import { describe, expect, it } from 'vitest';
import type { AssessmentSnapshot, RequirementSnapshot } from '../../src/models/api.types.js';
import type { Task } from '../../src/models/domain.js';
import { gapLines, openCriticalGaps, planProgress } from '../../src/services/plan-coverage.js';
import type { RequirementCode } from '../../src/services/requirements.js';

const requirement = (
  code: RequirementCode,
  status: RequirementSnapshot['status'],
  priority: RequirementSnapshot['solution']['priority'] = 'high',
  phase: RequirementSnapshot['solution']['phase'] = 'phase_1_urgent',
): RequirementSnapshot => ({
  code,
  label: code,
  channel: 'commercial',
  status,
  weightPoints: 30,
  requiredBy: ['industrial_client'],
  requiredByLabel: 'Cliente industrial',
  solution: { title: `Solução ${code}`, executorType: 'p4s', phase, priority, estimatedCost: 1000, deadlineDays: 30 },
});

const task = (overrides: Partial<Task>): Task => ({
  id: 'tarefa',
  assessmentId: 'diagnostico',
  companyId: 'empresa',
  title: 'Entregável',
  description: null,
  domain: 'ecovadis',
  priority: 'high',
  status: 'backlog',
  executorType: 'p4s',
  phase: 'phase_1_urgent',
  includedInProposal: true,
  estimatedCost: 1000,
  deadline: '2026-12-17',
  assignedUserId: null,
  requirementCode: null,
  origin: 'assessment',
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
  ...overrides,
});

const snapshot: Pick<AssessmentSnapshot, 'requirements'> = {
  requirements: [
    requirement('ecovadis', 'gap', 'critical'),
    requirement('carbon_scope_1_2', 'compliant', 'critical'),
    requirement('carbon_scope_3', 'gap', 'high', 'phase_2_structural'),
    requirement('banking_esg', 'not_applicable'),
    requirement('information_security', 'gap', 'critical'),
  ],
};

describe('lacunas e os entregáveis que lhes respondem', () => {
  it('só as lacunas dão linha, pela ordem do diagnóstico', () => {
    expect(gapLines(snapshot, []).map((line) => line.requirement.code)).toEqual([
      'ecovadis',
      'carbon_scope_3',
      'information_security',
    ]);
  });

  it('distingue o que está na proposta, a cargo da empresa, fora da proposta e eliminado', () => {
    const lines = gapLines(snapshot, [
      task({ id: 'a', requirementCode: 'ecovadis', executorType: 'internal' }),
      task({ id: 'b', requirementCode: 'carbon_scope_3', includedInProposal: false }),
      task({ id: 'extra', requirementCode: null }),
    ]);
    expect(lines.map((line) => [line.requirement.code, line.coverage, line.task?.id ?? null])).toEqual([
      ['ecovadis', 'internal', 'a'],
      ['carbon_scope_3', 'excluded', 'b'],
      ['information_security', 'removed', null],
    ]);
  });

  it('um entregável do parceiro incluído conta como proposta', () => {
    const [, , infosec] = gapLines(snapshot, [task({ requirementCode: 'information_security', executorType: 'partner' })]);
    expect(infosec?.coverage).toBe('proposal');
  });

  it('a linha segue a fase atual do entregável e, sem ele, a da solução-tipo', () => {
    const moved = gapLines(snapshot, [task({ requirementCode: 'carbon_scope_3', phase: 'phase_1_urgent' })]);
    expect(moved.find((line) => line.requirement.code === 'carbon_scope_3')?.phase).toBe('phase_1_urgent');
    expect(gapLines(snapshot, []).find((line) => line.requirement.code === 'carbon_scope_3')?.phase).toBe('phase_2_structural');
  });

  it('a lacuna fica resolvida quando o entregável está concluído', () => {
    const lines = gapLines(snapshot, [task({ requirementCode: 'ecovadis', status: 'completed' })]);
    expect(lines.map((line) => line.resolved)).toEqual([true, false, false]);
  });
});

describe('lacunas críticas em aberto', () => {
  it('conta lacunas, não tarefas: eliminar o entregável não a faz desaparecer', () => {
    expect(openCriticalGaps(gapLines(snapshot, []))).toBe(2);
  });

  it('baixar a prioridade da tarefa também não', () => {
    const lines = gapLines(snapshot, [
      task({ requirementCode: 'ecovadis', priority: 'low' }),
      task({ requirementCode: 'information_security', priority: 'low' }),
    ]);
    expect(openCriticalGaps(lines)).toBe(2);
  });

  it('desce quando o entregável é concluído', () => {
    const lines = gapLines(snapshot, [
      task({ requirementCode: 'ecovadis', status: 'completed' }),
      task({ requirementCode: 'information_security' }),
    ]);
    expect(openCriticalGaps(lines)).toBe(1);
  });
});

describe('andamento do plano', () => {
  const today = '2026-12-01';

  it('conta concluídas, em curso e em atraso, e diz o próximo prazo', () => {
    const progress = planProgress(
      [
        task({ title: 'Concluída', status: 'completed', deadline: '2026-11-20' }),
        task({ title: 'Em curso', status: 'in_progress', deadline: '2026-12-20' }),
        task({ title: 'Em revisão e atrasada', status: 'review', deadline: '2026-11-30' }),
        task({ title: 'Por começar', status: 'backlog', deadline: '2026-12-05' }),
        task({ title: 'Sem prazo', status: 'backlog', deadline: null }),
      ],
      today,
    );
    expect(progress).toEqual({
      total: 5,
      completed: 1,
      inProgress: 2,
      overdue: 1,
      next: { deadline: '2026-12-05', title: 'Por começar' },
    });
  });

  it('uma tarefa concluída nunca conta como atrasada, e o prazo de hoje ainda não está ultrapassado', () => {
    const progress = planProgress(
      [task({ status: 'completed', deadline: '2026-01-01' }), task({ title: 'Hoje', status: 'backlog', deadline: today })],
      today,
    );
    expect(progress.overdue).toBe(0);
    expect(progress.next).toEqual({ deadline: today, title: 'Hoje' });
  });

  it('sem tarefas por concluir não há próximo prazo', () => {
    expect(planProgress([task({ status: 'completed' })], today).next).toBeNull();
    expect(planProgress([], today)).toEqual({ total: 0, completed: 0, inProgress: 0, overdue: 0, next: null });
  });
});
