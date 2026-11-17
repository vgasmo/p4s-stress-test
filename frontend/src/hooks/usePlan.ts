import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@engine/models/domain';
import type { RequirementCode } from '@engine/services/requirements';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { tasksKey } from './useTasks';

/** Repõe o entregável-tipo de uma lacuna cujo entregável foi eliminado (equipa P4S). */
export function useRestoreDeliverable(assessmentId: string) {
  const session = useSession();
  const queryClient = useQueryClient();
  const key = tasksKey(session?.companyId, assessmentId);

  return useMutation({
    mutationFn: (code: RequirementCode) => api.restoreDeliverable(assessmentId, code),
    onSuccess: (restored) => {
      queryClient.setQueryData<Task[]>(key, (tasks) => [...(tasks ?? []), restored]);
      // Volta a pedir a lista para o entregável entrar na ordem do servidor.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
