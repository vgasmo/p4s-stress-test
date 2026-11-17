import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentAnalysisDetail, DocumentListResponse, FindingReviewStatus } from '@engine/models/api.types';
import type { RequirementCode } from '@engine/services/requirements';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Enquanto há uma análise em curso, o ecrã pergunta pelo estado de 3 em 3 segundos. */
const POLL_MS = 3000;

const documentsKey = (companyId: string | null | undefined) => ['documents', companyId] as const;
const documentKey = (companyId: string | null | undefined, id: string | undefined) => ['documents', companyId, 'detail', id] as const;
const evidenceKey = (companyId: string | null | undefined) => ['document-evidence', companyId] as const;

/** Documentos analisados para a empresa selecionada (equipa P4S). */
export function useDocuments() {
  const session = useSession();
  return useQuery({
    queryKey: documentsKey(session?.companyId),
    queryFn: api.listDocuments,
    enabled: Boolean(session?.companyId),
    refetchInterval: (query) =>
      (query.state.data as DocumentListResponse | undefined)?.analyses.some((analysis) => analysis.status === 'processing') ? POLL_MS : false,
  });
}

/** Um documento com as exigências extraídas. */
export function useDocument(id: string | undefined) {
  const session = useSession();
  return useQuery({
    queryKey: documentKey(session?.companyId, id),
    queryFn: () => api.getDocument(id as string),
    enabled: Boolean(session?.companyId && id),
    refetchInterval: (query) => ((query.state.data as DocumentAnalysisDetail | undefined)?.status === 'processing' ? POLL_MS : false),
  });
}

/**
 * Exigências confirmadas, por requisito, para mostrar no plano. Se falhar, o plano continua a
 * abrir sem elas: a evidência acrescenta contexto, não é condição para ver o plano.
 */
export function useEvidence() {
  const session = useSession();
  return useQuery({
    queryKey: evidenceKey(session?.companyId),
    queryFn: api.listEvidence,
    enabled: Boolean(session?.companyId),
    retry: false,
  });
}

function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
    void queryClient.invalidateQueries({ queryKey: ['document-evidence'] });
  };
}

export function useUploadDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({ mutationFn: (file: File) => api.uploadDocument(file), onSuccess: invalidate });
}

export function useDeleteDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({ mutationFn: (id: string) => api.deleteDocument(id), onSuccess: invalidate });
}

export interface FindingReviewInput {
  analysisId: string;
  findingId: string;
  patch: { reviewStatus?: FindingReviewStatus; requirementCode?: RequirementCode | null };
}

export function useReviewFinding() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: ({ analysisId, findingId, patch }: FindingReviewInput) => api.reviewFinding(analysisId, findingId, patch),
    // Com erro também: o ecrã volta a mostrar o que está de facto gravado.
    onSettled: invalidate,
  });
}
