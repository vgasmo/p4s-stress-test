import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { AssessmentDetail, CreatedAssessment } from '@engine/models/api.types';
import type { UpdateCompanyInput } from '@engine/models/schemas';
import type { Catalog, StressTestInput } from '@engine/services/requirements';
import { StressTestCalculatorService, type StressTestResult } from '@engine/services/stress-test-calculator.service';
import { TaskGeneratorService, type GeneratedTaskDraft } from '@engine/services/task-generator.service';
import { todayInLisbon } from '@engine/utils/dates';
import { api, type CreateAssessmentPayload } from '@/lib/api';
import { isStaffSession, sessionStore, useSession } from '@/lib/session';
import { tasksKey } from './useTasks';

const generator = new TaskGeneratorService();

/**
 * Catálogo (pesos, pisos, preços, prazos). Vem da API e só para a equipa P4S: não está no
 * código público nem chega às contas das empresas. Muda com a versão da aplicação, por
 * isso não se volta a pedir.
 */
export function useCatalog() {
  const session = useSession();
  return useQuery({
    queryKey: ['catalog', session?.user.id],
    queryFn: api.getCatalog,
    enabled: isStaffSession(session),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export interface LocalPreview {
  result: StressTestResult;
  suggestedTasks: GeneratedTaskDraft[];
}

/**
 * Cálculo em memória com o mesmo motor da API: o preview responde no mesmo frame,
 * funciona sem rede e dá exatamente o número que fica gravado. Null enquanto não há catálogo.
 */
export function useStressTestPreview(
  input: StressTestInput,
  catalog: Catalog | undefined,
): LocalPreview | { error: string } | null {
  const calculator = useMemo(() => (catalog ? new StressTestCalculatorService(catalog) : null), [catalog]);
  const key = JSON.stringify(input);
  return useMemo(() => {
    if (!calculator) return null;
    try {
      const result = calculator.calculate(input);
      return { result, suggestedTasks: generator.generate(result.gaps, todayInLisbon()) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Dados inválidos.' };
    }
    // O input é comparado pelo conteúdo (key), não pela identidade do objeto.
  }, [calculator, key]);
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
    // O valor é comparado pelo conteúdo (key).
  }, [key, delayMs]);
  return debounced;
}

/**
 * Simulação sem sessão: o servidor devolve ordens de grandeza por escalões. O pedido
 * espera 250 ms depois da última alteração e mantém o resultado anterior no ecrã.
 */
export function usePublicSimulation(input: StressTestInput, enabled: boolean) {
  const debounced = useDebounced(input, 250);
  return useQuery({
    queryKey: ['public-simulation', debounced],
    queryFn: ({ signal }) => api.simulatePublic(debounced, signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export const assessmentKey = (companyId: string | null | undefined, id: string) => ['assessment', companyId, id] as const;

export function useAssessments() {
  const session = useSession();
  return useQuery({
    queryKey: ['assessments', session?.companyId],
    queryFn: api.listAssessments,
    enabled: Boolean(session?.companyId),
  });
}

export function useAssessment(id: string | undefined) {
  const session = useSession();
  return useQuery({
    queryKey: assessmentKey(session?.companyId, id ?? ''),
    queryFn: () => api.getAssessment(id as string),
    enabled: Boolean(session?.companyId && id),
  });
}

/**
 * Guarda o diagnóstico. Se a P4S criou a empresa na hora, a sessão passa para essa
 * empresa antes de semear as caches, para o plano abrir já no contexto certo.
 */
export function useCreateAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAssessmentPayload): Promise<CreatedAssessment> => {
      const detail = await api.createAssessment(payload);
      if (sessionStore.get()?.companyId !== detail.company.id) await api.switchCompany(detail.company.id);
      return detail;
    },
    onSuccess: (detail) => {
      const companyId = detail.company.id;
      queryClient.setQueryData(assessmentKey(companyId, detail.id), detail);
      queryClient.setQueryData(tasksKey(companyId, detail.id), detail.tasks);
      void queryClient.invalidateQueries({ queryKey: ['assessments', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/** Reemite a proposta com a data de hoje (equipa P4S). Os prazos por começar deslizam. */
export function useReissueProposal(assessmentId: string) {
  const session = useSession();
  const queryClient = useQueryClient();
  const companyId = session?.companyId;
  return useMutation({
    mutationFn: () => api.reissueProposal(assessmentId),
    onSuccess: (detail: AssessmentDetail) => {
      queryClient.setQueryData(assessmentKey(companyId, assessmentId), detail);
      queryClient.setQueryData(tasksKey(companyId, assessmentId), detail.tasks);
      void queryClient.invalidateQueries({ queryKey: ['assessments', companyId] });
    },
  });
}

/**
 * Tira da cache os dados de um diagnóstico eliminado assim que nenhum ecrã os estiver a usar.
 * Tirá-los com o plano ainda aberto fazia o ecrã voltar a pedi-los, e a resposta era um 404.
 */
function dropWhenUnused(queryClient: QueryClient, queryKey: QueryKey): void {
  const cache = queryClient.getQueryCache();
  const query = cache.find({ queryKey, exact: true });
  if (!query) return;
  if (query.getObserversCount() === 0) {
    cache.remove(query);
    return;
  }
  const unsubscribe = cache.subscribe((event) => {
    if (event.query !== query) return;
    if (event.type === 'removed') unsubscribe();
    else if (event.type === 'observerRemoved' && query.getObserversCount() === 0) {
      unsubscribe();
      cache.remove(query);
    }
  });
}

/**
 * Elimina um diagnóstico e as tarefas dele (equipa P4S). Quem chama sai do plano quando a
 * eliminação termina: nessa altura a lista de diagnósticos da empresa já está atualizada.
 */
export function useDeleteAssessment() {
  const session = useSession();
  const queryClient = useQueryClient();
  const companyId = session?.companyId;
  return useMutation({
    mutationFn: (assessmentId: string) => api.deleteAssessment(assessmentId),
    onSuccess: async (_result, assessmentId) => {
      dropWhenUnused(queryClient, assessmentKey(companyId, assessmentId));
      dropWhenUnused(queryClient, tasksKey(companyId, assessmentId));
      // Só a lista (chave exata): o diagnóstico eliminado não se volta a pedir.
      await queryClient.invalidateQueries({ queryKey: ['assessments', companyId], exact: true });
    },
  });
}

/** Corrige os dados da empresa selecionada (equipa P4S). */
export function useUpdateCompany(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateCompanyInput) => api.updateCompany(companyId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
      // O nome e o NIF vêm dentro de cada diagnóstico (cabeçalho do plano e resumo impresso).
      void queryClient.invalidateQueries({ queryKey: ['assessment', companyId] });
    },
  });
}
