import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserRole } from '@engine/models/domain';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

const companyUsersKey = (companyId: string | null | undefined) => ['managed-users', 'company', companyId] as const;
const teamKey = ['managed-users', 'team'] as const;

/** Utilizadores da empresa selecionada (equipa P4S). */
export function useCompanyUsers() {
  const session = useSession();
  return useQuery({
    queryKey: companyUsersKey(session?.companyId),
    queryFn: api.listCompanyUsers,
    enabled: Boolean(session?.companyId),
  });
}

/** Equipa P4S (só administradores). */
export function useTeam(enabled: boolean) {
  return useQuery({ queryKey: teamKey, queryFn: api.listTeam, enabled });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['managed-users'] });
    // A lista de responsáveis possíveis das tarefas também muda.
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (payload: { email: string; fullName: string; role?: UserRole }) => api.createUser(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { fullName?: string; isActive?: boolean } }) =>
      api.updateUser(id, patch),
    onSuccess: invalidate,
  });
}

export function useCreatePasswordLink() {
  const invalidate = useInvalidateUsers();
  return useMutation({ mutationFn: (id: string) => api.createPasswordLink(id), onSuccess: invalidate });
}
