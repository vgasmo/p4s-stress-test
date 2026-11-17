import { Building2, FileSearch } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AnalysisDetail, AnalysisSkeleton } from '@/components/documents/AnalysisDetail';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUpload } from '@/components/documents/DocumentUpload';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { useMe } from '@/hooks/useAuth';
import { useDocuments } from '@/hooks/useDocuments';
import { errorMessage } from '@/lib/api';
import { isStaffSession, useSession } from '@/lib/session';

/**
 * Análise de documentos com IA. Ferramenta interna da equipa P4S: o consultor carrega o que o
 * cliente recebeu (questionário, código de conduta, carta do banco), revê o levantamento e só
 * o que confirmar passa a evidência no plano.
 */
export function DocumentsPage() {
  const session = useSession();
  const me = useMe();
  const navigate = useNavigate();
  const { analysisId } = useParams<{ analysisId?: string }>();
  const documents = useDocuments();

  if (!isStaffSession(session)) return <Navigate to="/plano" replace />;

  const open = (id: string | undefined) => navigate(id ? `/documentos/${encodeURIComponent(id)}` : '/documentos', { replace: !id });

  return (
    <div className="space-y-4">
      <header className="max-w-3xl">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">Análise com IA · só equipa P4S</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">Documentos</h1>
        <p className="mt-1 text-sm text-slate-700">
          Carregue o que o cliente ou o banco enviaram à empresa. A IA levanta as exigências feitas ao fornecedor, cada uma com
          a frase do documento que a sustenta. O que confirmar aqui passa a aparecer no plano do cliente, ao lado do requisito.
        </p>
      </header>

      {!session?.companyId ? (
        <EmptyState
          icon={Building2}
          title="Escolha a empresa cliente"
          description="Os documentos ficam associados a uma empresa. Selecione-a no topo."
        />
      ) : documents.isPending ? (
        <AnalysisSkeleton label="A carregar os documentos" />
      ) : documents.isError ? (
        <ErrorBanner
          title="Não foi possível carregar os documentos."
          message={errorMessage(documents.error)}
          onRetry={() => void documents.refetch()}
          retrying={documents.isFetching}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="space-y-4">
            <DocumentUpload
              ai={documents.data.ai}
              limits={documents.data.limits}
              companyName={me.data?.company?.name}
              onUploaded={open}
            />
            <DocumentList analyses={documents.data.analyses} selectedId={analysisId} onSelect={open} />
          </div>
          {analysisId ? (
            // key: ao mudar de documento, o painel recomeça (confirmações de eliminar, erros).
            <AnalysisDetail key={analysisId} analysisId={analysisId} onGone={() => open(undefined)} />
          ) : (
            <EmptyState
              icon={FileSearch}
              title={documents.data.analyses.length === 0 ? 'Ainda não há documentos analisados' : 'Escolha um documento'}
              description={
                documents.data.analyses.length === 0
                  ? 'Depois de carregar um documento, as exigências aparecem aqui para rever, uma a uma, com a citação à vista.'
                  : 'As exigências do documento escolhido aparecem aqui para rever, uma a uma, com a citação à vista.'
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
