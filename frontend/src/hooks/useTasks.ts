import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@engine/models/domain';
import type { UpdateTaskInput } from '@engine/models/schemas';
import { api, type CreateTaskPayload } from '@/lib/api';
import { useSession } from '@/lib/session';

export const tasksKey = (companyId: string | null | undefined, assessmentId: string) =>
  ['tasks', companyId, assessmentId] as const;

export function useTasks(assessmentId: string | undefined) {
  const session = useSession();
  return useQuery({
    queryKey: tasksKey(session?.companyId, assessmentId ?? ''),
    queryFn: () => api.listTasks(assessmentId as string),
    enabled: Boolean(session?.companyId && assessmentId),
  });
}

interface UpdateVariables {
  id: string;
  patch: UpdateTaskInput;
}

const replaceTask = (tasks: Task[] | undefined, next: Task) => tasks?.map((task) => (task.id === next.id ? next : task));

/**
 * Atualização otimista: o plano e os totais mudam antes da resposta. Numa reunião há
 * vários cliques seguidos, por isso cada mutação só reverte a sua própria tarefa e a
 * resposta do servidor só é escrita quando já não há outras alterações a caminho.
 */
export function useUpdateTask(assessmentId: string) {
  const session = useSession();
  const queryClient = useQueryClient();
  const key = tasksKey(session?.companyId, assessmentId);
  const mutationKey = ['task-update', session?.companyId, assessmentId];

  return useMutation({
    mutationKey,
    mutationFn: ({ id, patch }: UpdateVariables) => api.updateTask(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key)?.find((task) => task.id === id);
      queryClient.setQueryData<Task[]>(key, (tasks) =>
        tasks?.map((task) => (task.id === id ? ({ ...task, ...patch } as Task) : task)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      const previous = context?.previous;
      if (previous) queryClient.setQueryData<Task[]>(key, (tasks) => replaceTask(tasks, previous));
    },
    onSuccess: (saved) => {
      // Esta mutação ainda conta como ativa: 1 significa que é a última.
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      queryClient.setQueryData<Task[]>(key, (tasks) => replaceTask(tasks, saved));
    },
  });
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

export function useDeleteTask(assessmentId: string) {
  const session = useSession();
  const queryClient = useQueryClient();
  const key = tasksKey(session?.companyId, assessmentId);

  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (tasks) => tasks?.filter((task) => task.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
}
