// Alterações às tarefas de um plano enquanto o servidor não responde, e as que ele não gravou.
//
// A lista em cache guarda só o que o servidor confirmou. O que o ecrã mostra é essa lista com
// as alterações em curso por cima, pela ordem em que foram feitas. Daqui sai que:
//   - a resposta de um pedido antigo nunca tapa uma alteração mais recente;
//   - uma falha tira de cima só a alteração que falhou, ou seja, só os campos que ela mudava;
//   - quando já não há pedidos em curso, o ecrã mostra exatamente o que está gravado.

import type { Task } from '@engine/models/domain';
import type { UpdateTaskInput } from '@engine/models/schemas';
import { EXECUTOR_LABELS, STATUS_LABELS } from '@/lib/formatters';

export type TaskPatch = UpdateTaskInput;

/** Alteração já mostrada no ecrã, ainda sem resposta do servidor. */
export type PendingChange =
  | { seq: number; taskId: string; kind: 'update'; patch: TaskPatch; taskTitle: string; report: boolean }
  | { seq: number; taskId: string; kind: 'remove' };

/** Alteração que o servidor não gravou. No ecrã já foi desfeita. */
export interface FailedChange {
  seq: number;
  taskId: string;
  taskTitle: string;
  patch: TaskPatch;
  message: string;
}

const fieldsOf = (patch: TaskPatch) => (Object.keys(patch) as (keyof TaskPatch)[]).filter((field) => patch[field] !== undefined);

function pick(patch: TaskPatch, keep: (field: keyof TaskPatch) => boolean): TaskPatch {
  return Object.fromEntries(fieldsOf(patch).filter(keep).map((field) => [field, patch[field]])) as TaskPatch;
}

/** A lista confirmada pelo servidor com as alterações em curso por cima: é isto que o ecrã mostra. */
export function applyPendingChanges(tasks: Task[], pending: readonly PendingChange[]): Task[] {
  if (pending.length === 0) return tasks;
  const removed = new Set<string>();
  const patches = new Map<string, TaskPatch>();
  for (const change of pending) {
    if (change.kind === 'remove') removed.add(change.taskId);
    else patches.set(change.taskId, { ...patches.get(change.taskId), ...pick(change.patch, () => true) });
  }
  return tasks
    .filter((task) => !removed.has(task.id))
    .map((task) => {
      const patch = patches.get(task.id);
      return patch ? ({ ...task, ...patch } as Task) : task;
    });
}

/** Tira das falhas de uma tarefa os campos indicados. Uma falha sem campos desaparece. */
function withoutFields(
  failed: readonly FailedChange[],
  taskId: string,
  fields: readonly (keyof TaskPatch)[],
): readonly FailedChange[] {
  if (!failed.some((entry) => entry.taskId === taskId && fields.some((field) => field in entry.patch))) return failed;
  return failed.flatMap((entry) => {
    if (entry.taskId !== taskId) return [entry];
    const patch = pick(entry.patch, (field) => !fields.includes(field));
    return fieldsOf(patch).length > 0 ? [{ ...entry, patch }] : [];
  });
}

/**
 * Depois de ler o servidor: o aviso deixa de mostrar o que afinal lá está (o pedido chegou,
 * a resposta é que se perdeu) e as tarefas que entretanto deixaram de existir.
 */
export function dropSettledFailures(failed: readonly FailedChange[], tasks: readonly Task[]): readonly FailedChange[] {
  const next = failed.flatMap((entry) => {
    const task = tasks.find((candidate) => candidate.id === entry.taskId);
    if (!task) return [];
    const patch = pick(entry.patch, (field) => task[field] !== entry.patch[field]);
    const left = fieldsOf(patch).length;
    if (left === 0) return [];
    return left === fieldsOf(entry.patch).length ? [entry] : [{ ...entry, patch }];
  });
  return next.length === failed.length && next.every((entry, index) => entry === failed[index]) ? failed : next;
}

interface UpdateOptions {
  /** A falha vai para o aviso do plano. Falso quando quem pede mostra o erro (painel de edição). */
  report: boolean;
  send: () => Promise<Task>;
  /** Escreve a tarefa gravada na lista confirmada pelo servidor. */
  saved: (task: Task) => void;
  describe: (error: unknown) => string;
}

interface RemoveOptions {
  send: () => Promise<void>;
  /** Tira a tarefa da lista confirmada pelo servidor. */
  removed: () => void;
}

/**
 * Regista as alterações de um plano: as que esperam resposta e as que falharam. Um registo por
 * plano, fora dos componentes, para sobreviver a mudanças de separador e de página.
 */
export class TaskChangeTracker {
  private seq = 0;
  private pending: readonly PendingChange[] = [];
  private failed: readonly FailedChange[] = [];
  private readonly queues = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private changes = 0;
  private owesRead = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getPending = (): readonly PendingChange[] => this.pending;
  readonly getFailed = (): readonly FailedChange[] => this.failed;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Os pedidos da mesma tarefa seguem um de cada vez, pela ordem em que foram feitos. */
  private inOrder<T>(taskId: string, send: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(taskId) ?? Promise.resolve();
    const result = previous.then(send);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(taskId, tail);
    void tail.then(() => {
      if (this.queues.get(taskId) === tail) this.queues.delete(taskId);
    });
    return result;
  }

  private begin(change: PendingChange): void {
    this.pending = [...this.pending, change];
    this.changes += 1;
    // Quem volta a mexer num campo já não quer repetir o valor antigo que tinha falhado.
    if (change.kind === 'update') this.failed = withoutFields(this.failed, change.taskId, fieldsOf(change.patch));
    this.emit();
  }

  private settle(change: PendingChange, failure?: string): void {
    this.pending = this.pending.filter((entry) => entry !== change);
    this.changes += 1;
    if (failure !== undefined) {
      // Não se sabe se o pedido chegou a ser aplicado: a lista tem de voltar a ser lida.
      this.owesRead = true;
      if (change.kind === 'update' && change.report) {
        // Os campos que uma alteração posterior voltou a mudar seguem o destino dessa.
        const later = this.pending.flatMap((entry) =>
          entry.kind === 'update' && entry.taskId === change.taskId && entry.seq > change.seq ? fieldsOf(entry.patch) : [],
        );
        const patch = pick(change.patch, (field) => !later.includes(field));
        if (fieldsOf(patch).length > 0) {
          const { seq, taskId, taskTitle } = change;
          this.failed = [...this.failed, { seq, taskId, taskTitle, patch, message: failure }];
        }
      }
    } else if (change.kind === 'remove') {
      this.failed = this.failed.filter((entry) => entry.taskId !== change.taskId);
    }
    this.emit();
  }

  /** Altera uma tarefa: mostra já a alteração, espera a vez da tarefa e regista o resultado. */
  async update(task: Pick<Task, 'id' | 'title'>, patch: TaskPatch, options: UpdateOptions): Promise<Task> {
    const change: PendingChange = {
      seq: ++this.seq,
      taskId: task.id,
      kind: 'update',
      patch,
      taskTitle: task.title,
      report: options.report,
    };
    this.begin(change);
    try {
      const saved = await this.inOrder(task.id, options.send);
      // Primeiro a lista confirmada, depois sai a alteração de cima: o ecrã nunca volta ao valor antigo.
      options.saved(saved);
      this.settle(change);
      return saved;
    } catch (error) {
      this.settle(change, options.describe(error));
      throw error;
    }
  }

  /** Elimina uma tarefa, depois das alterações que ela ainda tenha a caminho. */
  async remove(taskId: string, options: RemoveOptions): Promise<void> {
    const change: PendingChange = { seq: ++this.seq, taskId, kind: 'remove' };
    this.begin(change);
    try {
      await this.inOrder(taskId, options.send);
      options.removed();
      this.settle(change);
    } catch (error) {
      this.settle(change, '');
      throw error;
    }
  }

  /** As alterações falhadas saem do aviso para serem repetidas. */
  takeFailed(): readonly FailedChange[] {
    const failed = this.failed;
    this.dismissFailed();
    return failed;
  }

  dismissFailed(): void {
    if (this.failed.length === 0) return;
    this.failed = [];
    this.emit();
  }

  /** Sobe a cada alteração enviada ou respondida: uma leitura da lista pedida antes já não vale. */
  get revision(): number {
    return this.changes;
  }

  /** Uma leitura da lista que estava em curso foi posta de parte: fica outra por fazer. */
  requestRead(): void {
    this.owesRead = true;
  }

  /** Há uma leitura da lista por fazer e nenhum pedido em curso que a possa desatualizar. */
  get wantsRead(): boolean {
    return this.owesRead && this.pending.length === 0;
  }

  /**
   * Chegou a lista lida do servidor. Só vale se não houve alterações desde `revision`: nesse
   * caso devolve true e quem chama escreve-a na lista confirmada.
   */
  acceptRead(revision: number, tasks: readonly Task[]): boolean {
    if (revision !== this.changes) return false;
    this.owesRead = false;
    const failed = dropSettledFailures(this.failed, tasks);
    if (failed !== this.failed) {
      this.failed = failed;
      this.emit();
    }
    return true;
  }
}

function describeField(field: keyof TaskPatch, patch: TaskPatch): string {
  switch (field) {
    case 'includedInProposal':
      return patch.includedInProposal ? 'incluir na proposta' : 'retirar da proposta';
    case 'status':
      return patch.status ? `estado «${STATUS_LABELS[patch.status]}»` : 'estado';
    case 'executorType':
      return patch.executorType ? `executor ${EXECUTOR_LABELS[patch.executorType]}` : 'executor';
    case 'title':
      return 'título';
    case 'description':
      return 'descrição';
    case 'domain':
      return 'domínio';
    case 'priority':
      return 'prioridade';
    case 'phase':
      return 'fase';
    case 'estimatedCost':
      return 'honorários';
    case 'deadline':
      return 'prazo';
    case 'assignedUserId':
      return 'responsável';
  }
}

/** O que a alteração tentava mudar, por palavras: «retirar da proposta, estado «Em Curso»». */
export function describePatch(patch: TaskPatch): string {
  return fieldsOf(patch)
    .map((field) => describeField(field, patch))
    .join(', ');
}

export interface FailureSummary {
  title: string;
  /** Motivo, quando é o mesmo para todas. Senão vai em cada linha. */
  message: string | null;
  lines: { seq: number; text: string }[];
}

/** Texto do aviso: todas as alterações que falharam, com a tarefa e o que se tentou mudar. */
export function summarizeFailures(failed: readonly FailedChange[]): FailureSummary {
  const messages = new Set(failed.map((entry) => entry.message));
  const shared = messages.size === 1 ? (failed[0]?.message ?? null) : null;
  return {
    title:
      failed.length === 1
        ? 'A alteração não foi guardada e foi revertida.'
        : `${failed.length} alterações não foram guardadas e foram revertidas.`,
    message: shared,
    lines: failed.map((entry) => ({
      seq: entry.seq,
      text: [`«${entry.taskTitle}»`, describePatch(entry.patch), ...(shared === null ? [entry.message] : [])].join(' · '),
    })),
  };
}
