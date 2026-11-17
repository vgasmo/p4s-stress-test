// Regras de UI que espelham o RBAC da API (a API continua a ser quem decide).

import { isPricedExecutor, type Task } from '@engine/models/domain';

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

export function isOverdue(task: Pick<Task, 'deadline' | 'status'>, today: string): boolean {
  return Boolean(task.deadline && task.status !== 'completed' && task.deadline < today);
}
