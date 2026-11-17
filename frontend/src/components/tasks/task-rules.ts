// Regras de UI que espelham o RBAC da API (a API continua a ser quem decide).

import type { AssessmentSnapshot } from '@engine/models/api.types';
import type { Task, TaskPhase } from '@engine/models/domain';
import { PHASE_WINDOWS } from '@engine/services/requirements';
import { addDays } from '@engine/utils/dates';

/**
 * O que quem está a ver pode alterar numa tarefa.
 *  - all: a equipa P4S altera tudo;
 *  - own: a empresa altera as tarefas que ela própria criou (sempre internas), menos o executor;
 *  - follow-up: nas tarefas do diagnóstico e nas criadas pela P4S, a empresa só atualiza o
 *    estado e o responsável. Âmbito, prazo e preço são da P4S, seja qual for o executor.
 */
export type TaskEditScope = 'all' | 'own' | 'follow-up';

export function taskEditScope(task: Pick<Task, 'origin'>, staff: boolean): TaskEditScope {
  if (staff) return 'all';
  return task.origin === 'company' ? 'own' : 'follow-up';
}

/** Custo, fase e inclusão na proposta: quem os pode alterar nesta tarefa. */
export function canEditProposalTerms(task: Pick<Task, 'origin'>, staff: boolean): boolean {
  return taskEditScope(task, staff) !== 'follow-up';
}

/** Quem exige o entregável, lido do requisito que o gerou. Null nas tarefas criadas à mão. */
export function requiredByOf(task: Pick<Task, 'requirementCode'>, snapshot: AssessmentSnapshot): string | null {
  if (!task.requirementCode) return null;
  return snapshot.requirements.find((requirement) => requirement.code === task.requirementCode)?.requiredByLabel ?? null;
}

/** Último dia da janela da fase, contado a partir da data de emissão da proposta. */
export function phaseEndDate(baseDate: string, phase: TaskPhase): string {
  return addDays(baseDate, PHASE_WINDOWS[phase].untilDay);
}

/**
 * O prazo passa do fim da janela da fase. A proposta diz «Fase 1: 0–60 dias», por isso
 * uma tarefa da Fase 1 com prazo depois disso contradiz o próprio documento.
 */
export function isAfterPhaseWindow(task: { deadline: string | null; phase: TaskPhase }, baseDate: string): boolean {
  return Boolean(task.deadline && task.deadline > phaseEndDate(baseDate, task.phase));
}

export function isOverdue(task: Pick<Task, 'deadline' | 'status'>, today: string): boolean {
  return Boolean(task.deadline && task.status !== 'completed' && task.deadline < today);
}
