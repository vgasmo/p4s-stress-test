// Liga cada lacuna do diagnóstico ao entregável que hoje lhe responde no plano.
//
// O diagnóstico guarda uma fotografia (o que faltava e a solução-tipo). O plano muda depois:
// o consultor renegocia honorários, passa um entregável a interno, tira-o da proposta ou
// elimina-o, e a empresa vai concluindo trabalho. A matriz de conformidade, o resumo impresso
// e os indicadores leem daqui, para dizerem todos a mesma coisa que o configurador.
// Funções puras, partilhadas com o frontend.

import type { AssessmentSnapshot, RequirementSnapshot } from '../models/api.types.js';
import type { Task, TaskPhase } from '../models/domain.js';
import { countsTowardsProposal } from './remediation-summary.js';

/**
 * proposal: entregável da P4S ou do parceiro, incluído na proposta.
 * internal: fica a cargo da empresa.
 * excluded: existe no plano, mas fora da proposta.
 * removed: o entregável foi eliminado e a lacuna ficou sem resposta no plano.
 */
export type GapCoverageKind = 'proposal' | 'internal' | 'excluded' | 'removed';

export interface GapLine {
  requirement: RequirementSnapshot;
  coverage: GapCoverageKind;
  /** Entregável que responde à lacuna. Null quando foi eliminado. */
  task: Task | null;
  /** O entregável está concluído: a lacuna deixou de estar em aberto. */
  resolved: boolean;
  /** Fase em que a lacuna aparece: a do entregável atual ou, sem ele, a da solução-tipo. */
  phase: TaskPhase;
}

type CoverageTask = Pick<Task, 'requirementCode' | 'executorType' | 'includedInProposal' | 'status' | 'phase'>;

function coverageOf(task: CoverageTask | null): GapCoverageKind {
  if (!task) return 'removed';
  if (task.executorType === 'internal') return 'internal';
  return countsTowardsProposal(task) ? 'proposal' : 'excluded';
}

/** Uma linha por lacuna do diagnóstico, com o estado atual do entregável que lhe responde. */
export function gapLines(snapshot: Pick<AssessmentSnapshot, 'requirements'>, tasks: readonly Task[]): GapLine[] {
  return snapshot.requirements
    .filter((requirement) => requirement.status === 'gap')
    .map((requirement) => {
      const task = tasks.find((candidate) => candidate.requirementCode === requirement.code) ?? null;
      return {
        requirement,
        coverage: coverageOf(task),
        task,
        resolved: task?.status === 'completed',
        phase: task?.phase ?? requirement.solution.phase,
      };
    });
}

/**
 * Lacunas críticas ainda em aberto. Conta lacunas, não tarefas: eliminar o entregável ou
 * baixar-lhe a prioridade não faz desaparecer uma lacuna que continua por resolver.
 */
export function openCriticalGaps(lines: readonly GapLine[]): number {
  return lines.filter((line) => line.requirement.solution.priority === 'critical' && !line.resolved).length;
}

export interface PlanProgress {
  total: number;
  completed: number;
  inProgress: number;
  /** Por concluir e com o prazo ultrapassado. */
  overdue: number;
  /** Próximo prazo entre as tarefas por concluir. */
  next: { deadline: string; title: string } | null;
}

/** Andamento do plano: quantas tarefas estão concluídas, em curso e em atraso, e o que vem a seguir. */
export function planProgress(
  tasks: readonly Pick<Task, 'status' | 'deadline' | 'title'>[],
  today: string,
): PlanProgress {
  const open = tasks.filter((task) => task.status !== 'completed');
  const upcoming = open
    .filter((task): task is typeof task & { deadline: string } => task.deadline !== null && task.deadline >= today)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  return {
    total: tasks.length,
    completed: tasks.length - open.length,
    inProgress: open.filter((task) => task.status === 'in_progress' || task.status === 'review').length,
    overdue: open.filter((task) => task.deadline !== null && task.deadline < today).length,
    next: upcoming ? { deadline: upcoming.deadline, title: upcoming.title } : null,
  };
}
