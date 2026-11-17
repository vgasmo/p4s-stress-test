import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { Task } from '@engine/models/domain';
import type { UpdateTaskInput } from '@engine/models/schemas';
import { api, errorMessage, type CreateTaskPayload } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';
import { TaskChangeTracker, applyPendingChanges, type FailedChange } from '@/lib/task-changes';

export const tasksKey = (companyId: string | null | undefined, assessmentId: string) =>
  ['tasks', companyId, assessmentId] as const;

// Um registo de alterações por plano (empresa + diagnóstico). Vive fora dos componentes para os
// pedidos em curso e o aviso de falhas não se perderem ao mudar de separador ou de página.
const trackers = new Map<string, TaskChangeTracker>();

function trackerFor(companyId: string | null | undefined, assessmentId: string): TaskChangeTracker {
  const id = `${companyId ?? ''}|${assessmentId}`;
  let tracker = trackers.get(id);
  if (!tracker) {
    tracker = new TaskChangeTracker();
    trackers.set(id, tracker);
  }
  return tracker;
}

// Outra pessoa neste browser não herda os avisos (nem o «Tentar novamente») de quem saiu.
let trackedUser = sessionStore.get()?.user.id;
sessionStore.subscribe(() => {
  const user = sessionStore.get()?.user.id;
  if (user === trackedUser) return;
  trackedUser = user;
  trackers.clear();
});

/**
 * Tarefas do plano. A cache guarda só o que o servidor confirmou. O que se devolve é essa lista
 * com as alterações em curso por cima (ver lib/task-changes.ts).
 */
export function useTasks(assessmentId: string | undefined) {
  const session = useSession();
  const tracker = trackerFor(session?.companyId, assessmentId ?? '');
  const pending = useSyncExternalStore(tracker.subscribe, tracker.getPending);
  const select = useCallback((tasks: Task[]) => applyPendingChanges(tasks, pending), [pending]);
  return useQuery({
    queryKey: tasksKey(session?.companyId, assessmentId ?? ''),
    queryFn: () => api.listTasks(assessmentId as string),
    enabled: Boolean(session?.companyId && assessmentId),
    select,
  });
}

/** O plano sobre o qual uma alteração é feita: fica com ela mesmo que a sessão mude de empresa a meio. */
interface PlanContext {
  queryClient: QueryClient;
  companyId: string | null | undefined;
  assessmentId: string;
  key: ReturnType<typeof tasksKey>;
  tracker: TaskChangeTracker;
}

function usePlanContext(assessmentId: string): PlanContext {
  const queryClient = useQueryClient();
  const companyId = useSession()?.companyId;
  return {
    queryClient,
    companyId,
    assessmentId,
    key: tasksKey(companyId, assessmentId),
    tracker: trackerFor(companyId, assessmentId),
  };
}

/**
 * Uma leitura da lista que esteja em curso pode ter sido feita antes da alteração e chegar
 * depois dela: é posta de parte e a lista volta a ser lida quando os pedidos acabarem.
 */
function dropListReads({ queryClient, key, tracker }: PlanContext): void {
  if (queryClient.getQueryData(key) === undefined || queryClient.isFetching({ queryKey: key, exact: true }) === 0) return;
  tracker.requestRead();
  void queryClient.cancelQueries({ queryKey: key, exact: true });
}

// Leituras de confirmação em curso. Até chegarem, o ecrã pode ainda não ser o que está gravado:
// contam como alterações por confirmar (usePendingChanges).
let confirming = 0;
const confirmingListeners = new Set<() => void>();
function setConfirming(delta: 1 | -1): void {
  confirming += delta;
  for (const listener of confirmingListeners) listener();
}
export const savedTaskReads = {
  subscribe(listener: () => void): () => void {
    confirmingListeners.add(listener);
    return () => confirmingListeners.delete(listener);
  },
  inFlight: (): number => confirming,
};

/**
 * Depois de uma falha não se sabe se o pedido chegou a ser aplicado. Com os pedidos todos
 * respondidos, a lista é lida outra vez para o ecrã ficar com o que está mesmo gravado.
 * Sem ligação não faz nada: fica para a próxima alteração ou para quando a página voltar a ler.
 */
async function readSavedTasks({ queryClient, key, assessmentId, tracker }: PlanContext): Promise<void> {
  if (!tracker.wantsRead) return;
  const revision = tracker.revision;
  setConfirming(1);
  try {
    const tasks = await api.listTasks(assessmentId);
    if (tracker.acceptRead(revision, tasks)) queryClient.setQueryData<Task[]>(key, tasks);
  } catch {
    // Sem resposta: o que está no ecrã fica como está.
  } finally {
    setConfirming(-1);
  }
}

interface UpdateVariables {
  id: string;
  patch: UpdateTaskInput;
  /** A falha fica no aviso do plano (alterações feitas na tabela ou no kanban, sem painel aberto). */
  report?: boolean;
}

const replaceTask = (tasks: Task[] | undefined, next: Task) => tasks?.map((task) => (task.id === next.id ? next : task));

/**
 * Atualização otimista: o plano e os totais mudam antes da resposta. Numa reunião há vários
 * cliques seguidos, por isso os pedidos da mesma tarefa seguem um de cada vez e uma falha só
 * desfaz o que esse pedido tentou mudar.
 */
export function useUpdateTask(assessmentId: string) {
  const plan = usePlanContext(assessmentId);
  const { queryClient, key, tracker } = plan;

  return useMutation({
    mutationKey: ['task-update', plan.companyId, assessmentId],
    mutationFn: ({ id, patch, report = false }: UpdateVariables) => {
      const title = queryClient.getQueryData<Task[]>(key)?.find((task) => task.id === id)?.title ?? '';
      dropListReads(plan);
      return tracker.update({ id, title }, patch, {
        report,
        send: () => api.updateTask(id, patch),
        saved: (saved) => queryClient.setQueryData<Task[]>(key, (tasks) => replaceTask(tasks, saved)),
        describe: errorMessage,
      });
    },
    onSettled: () => {
      dropListReads(plan);
      void readSavedTasks(plan);
    },
  });
}

export interface TaskChanges {
  /** Altera uma tarefa na tabela ou no kanban. Se o servidor não gravar, a alteração vai para `failed`. */
  change: (task: Task, patch: UpdateTaskInput) => void;
  /** Alterações que não foram gravadas (no ecrã já estão desfeitas). */
  failed: readonly FailedChange[];
  /** Há pedidos deste plano ainda sem resposta. */
  saving: boolean;
  /** Volta a enviar todas as alterações que falharam. */
  retry: () => void;
  /** Esquece as alterações que falharam. */
  dismiss: () => void;
}

/** Alterações feitas diretamente no plano, com o registo das que falharam para o aviso. */
export function useTaskChanges(assessmentId: string): TaskChanges {
  const { tracker } = usePlanContext(assessmentId);
  const { mutate } = useUpdateTask(assessmentId);
  const failed = useSyncExternalStore(tracker.subscribe, tracker.getFailed);
  const pending = useSyncExternalStore(tracker.subscribe, tracker.getPending);

  return {
    change: (task, patch) => mutate({ id: task.id, patch, report: true }),
    failed,
    saving: pending.length > 0,
    retry: () => {
      for (const entry of tracker.takeFailed()) mutate({ id: entry.taskId, patch: entry.patch, report: true });
    },
    dismiss: () => tracker.dismissFailed(),
  };
}

export function useCreateTask(assessmentId: string) {
  const session = useSession();
  const queryClient = useQueryClient();
  const key = tasksKey(session?.companyId, assessmentId);

  return useMutation({
    mutationFn: (payload: CreateTaskPayload) => api.createTask(payload),
    onSuccess: (created) => {
      queryClient.setQueryData<Task[]>(key, (tasks) => [...(tasks ?? []), created]);
      // Volta a pedir a lista para a tarefa nova entrar na ordem do servidor.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** A tarefa sai já do ecrã. Se o servidor não a eliminar, volta a aparecer, sem mexer nas outras. */
export function useDeleteTask(assessmentId: string) {
  const plan = usePlanContext(assessmentId);
  const { queryClient, key, tracker } = plan;

  return useMutation({
    mutationFn: (id: string) => {
      dropListReads(plan);
      return tracker.remove(id, {
        send: () => api.deleteTask(id),
        removed: () => queryClient.setQueryData<Task[]>(key, (tasks) => tasks?.filter((task) => task.id !== id)),
      });
    },
    onSettled: () => {
      dropListReads(plan);
      void readSavedTasks(plan);
    },
  });
}
