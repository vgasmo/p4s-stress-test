import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assessmentKey } from '@/hooks/useAssessment';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { answersFromSnapshot, latestOpenable, type PreviousAnswers } from './previous-answers';

/**
 * Diagnóstico anterior da empresa selecionada, para a equipa P4S partir das respostas dele.
 * A lista e o diagnóstico usam as chaves de cache do plano de ação, por isso quem vem de lá
 * não espera. As respostas só são pedidas quando o consultor as pede.
 */
export function usePreviousDiagnosis() {
  const session = useSession();
  const companyId = session?.companyId ?? null;
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['assessments', companyId],
    queryFn: api.listAssessments,
    enabled: companyId !== null,
  });

  const answers = useMutation({
    mutationFn: async (assessmentId: string): Promise<PreviousAnswers> => {
      const detail = await queryClient.fetchQuery({
        queryKey: assessmentKey(companyId, assessmentId),
        queryFn: () => api.getAssessment(assessmentId),
      });
      const read = answersFromSnapshot(detail.snapshot?.input);
      if (!read) throw new Error('As respostas desse diagnóstico não se conseguem ler.');
      return read;
    },
    // O diagnóstico pode ter sido eliminado entretanto: a lista é pedida outra vez.
    onError: () => void queryClient.invalidateQueries({ queryKey: ['assessments', companyId] }),
  });

  return { latest: list.data ? latestOpenable(list.data) : null, answers };
}
