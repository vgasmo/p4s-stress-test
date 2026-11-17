// Regras de UI que espelham o RBAC da API (a API continua a ser quem decide).

import { isPricedExecutor, type Task, type TaskPhase } from '@engine/models/domain';
import { PHASE_WINDOWS } from '@engine/services/requirements';
import { addDays } from '@engine/utils/dates';

/**
 * Custo, executor, fase e inclusão na proposta de tarefas P4S ou do parceiro são
 * termos comerciais: só a equipa P4S os altera.
 */
export function canEditProposalTerms(task: Pick<Task, 'executorType'>, staff: boolean): boolean {
  return staff || !isPricedExecutor(task.executorType);
}

/** «Exigido por: Cliente industrial / Diretiva NIS2.» na descrição gerada pelo motor. */
export function requiredByFromDescription(description: string | null): string | null {
  const match = description ? /Exigido por: (.+?)\.?\s*$/m.exec(description) : null;
  return match?.[1] ?? null;
}

/** Descrição sem a linha «Exigido por», para mostrar em texto corrido. */
export function descriptionBody(description: string | null): string {
  return (description ?? '').replace(/\n*Exigido por: .+$/m, '').trim();
}

/** Último dia da janela da fase, contado a partir do dia do diagnóstico. */
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
