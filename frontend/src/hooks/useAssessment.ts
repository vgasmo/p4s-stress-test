import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AssessmentDetail } from '@engine/models/api.types';
import type { StressTestInput } from '@engine/services/requirements.catalog';
import { StressTestCalculatorService, type StressTestResult } from '@engine/services/stress-test-calculator.service';
import { TaskGeneratorService, type GeneratedTaskDraft } from '@engine/services/task-generator.service';
import { todayInLisbon } from '@engine/utils/dates';
import { api, type CreateAssessmentPayload } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';
import { tasksKey } from './useTasks';

const calculator = new StressTestCalculatorService();
const generator = new TaskGeneratorService();

export interface LocalPreview {
  result: StressTestResult;
  suggestedTasks: GeneratedTaskDraft[];
}

/**
 * Cálculo em memória com o mesmo motor da API: o preview responde no mesmo frame,
 * funciona sem rede e dá exatamente o número que fica gravado.
 */
export function useStressTestPreview(input: StressTestInput): LocalPreview | { error: string } {
  const key = JSON.stringify(input);
  return useMemo(() => {
    try {
      const result = calculator.calculate(input);
      return { result, suggestedTasks: generator.generate(result.gaps, todayInLisbon()) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Dados inválidos.' };
    }
  }, [key]);
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
    mutationFn: async (payload: CreateAssessmentPayload): Promise<AssessmentDetail> => {
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
