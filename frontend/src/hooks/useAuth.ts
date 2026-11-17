import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { clearWizardDrafts } from '@/components/wizard/wizard-draft';
import { api } from '@/lib/api';
import { isStaffSession, sessionStore, useSession } from '@/lib/session';

export function useAuthActions() {
  const queryClient = useQueryClient();

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.login(email, password);
      queryClient.clear();
      sessionStore.set(session);
      return session;
    },
    [queryClient],
  );

  /** Termina a sessão no servidor (todos os dispositivos) e limpa este browser, mesmo sem rede. */
  const logout = useCallback(async () => {
    await api.logout();
    // As respostas de uma reunião não ficam no separador para quem o usar a seguir.
    clearWizardDrafts();
    sessionStore.set(null);
    queryClient.clear();
  }, [queryClient]);

  /** Equipa P4S: muda a empresa da sessão. As caches estão chaveadas por empresa. */
  const switchCompany = useCallback(
    async (companyId: string | null) => {
      const session = await api.switchCompany(companyId);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      return session;
    },
    [queryClient],
  );

  return { login, logout, switchCompany };
}

export function useMe() {
  const session = useSession();
  return useQuery({
    queryKey: ['me', session?.user.id, session?.companyId],
    queryFn: api.me,
    enabled: session !== null,
    staleTime: 60_000,
  });
}

export function useCompanies() {
  const session = useSession();
  return useQuery({
    queryKey: ['companies'],
    queryFn: api.listCompanies,
    enabled: isStaffSession(session),
    staleTime: 60_000,
  });
}

export function useAssignableUsers() {
  const session = useSession();
  return useQuery({
    queryKey: ['users', session?.companyId],
    queryFn: api.listAssignableUsers,
    enabled: Boolean(session?.companyId),
    staleTime: 5 * 60_000,
  });
}
