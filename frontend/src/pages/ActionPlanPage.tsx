import { Building2, ClipboardList, FilePlus2, Printer, SearchX } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { AssessmentDetail, AssessmentListEntry } from '@engine/models/api.types';
import { ExecutiveScoreboard, ExecutiveScoreboardSkeleton } from '@/components/dashboard/ExecutiveScoreboard';
import { GapMatrix, GapMatrixSkeleton } from '@/components/dashboard/GapMatrix';
import { ExecutivePrintView } from '@/components/print/ExecutivePrintView';
import { TaskManagementBoard } from '@/components/tasks/TaskManagementBoard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { useAssessment, useAssessments } from '@/hooks/useAssessment';
import { useTasks } from '@/hooks/useTasks';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDatePt, formatEUR, sectorLabel } from '@/lib/formatters';
import { isStaffSession, useSession } from '@/lib/session';

export function ActionPlanPage() {
  const { assessmentId } = useParams();
  const session = useSession();
  const companyId = session?.companyId ?? null;

  // Empresa com que o diagnóstico do URL foi aberto. Se a equipa P4S trocar de empresa
  // com um plano aberto, esse id pertence à empresa anterior: em vez de o pedir (404),
  // abre-se o diagnóstico mais recente da nova empresa.
  const [opened, setOpened] = useState({ assessmentId, companyId });
  if (opened.assessmentId !== assessmentId) setOpened({ assessmentId, companyId });
  const belongsToPreviousCompany =
    assessmentId !== undefined && opened.assessmentId === assessmentId && opened.companyId !== companyId;

  if (!companyId) {
    return (
      <EmptyState
        icon={Building2}
        title={isStaffSession(session) ? 'Escolha a empresa cliente' : 'Sessão sem empresa associada'}
        description={
          isStaffSession(session)
            ? 'Selecione a empresa no topo ou faça um stress test novo e registe-a por NIF e nome.'
            : 'A sua conta não tem empresa. Fale com a equipa P4S.'
        }
        action={
          <Button asChild size="sm">
            <Link to="/">Iniciar Primeiro Stress Test</Link>
          </Button>
        }
      />
    );
  }

  if (belongsToPreviousCompany) return <Navigate to="/plano" replace />;

  return assessmentId ? <ActionPlan assessmentId={assessmentId} /> : <LatestAssessment />;
}

/** /plano sem id: abre o diagnóstico mais recente da empresa. */
function LatestAssessment() {
  const assessments = useAssessments();

  if (assessments.isSuccess && assessments.data[0]) {
    return <Navigate to={`/plano/${assessments.data[0].id}`} replace />;
  }

  if (assessments.isPending) return <PlanSkeleton />;
  if (assessments.isError) {
    return (
      <ErrorBanner
        title="Não foi possível carregar os diagnósticos."
        message={errorMessage(assessments.error)}
        onRetry={() => void assessments.refetch()}
        retrying={assessments.isFetching}
      />
    );
  }
  return (
    <EmptyState
      icon={ClipboardList}
      title="Ainda não há diagnósticos para esta empresa"
      description="O stress test demora cerca de 5 minutos e gera o plano de ação com preço e prazo fechados."
      action={
        <Button asChild size="sm">
          <Link to="/">Iniciar Primeiro Stress Test</Link>
        </Button>
      }
    />
  );
}

function ActionPlan({ assessmentId }: { assessmentId: string }) {
  const assessment = useAssessment(assessmentId);
  const tasks = useTasks(assessmentId);
  const history = useAssessments();

  if (assessment.isPending) return <PlanSkeleton />;

  if (assessment.isError) {
    return assessment.error instanceof ApiError && assessment.error.status === 404 ? (
      <EmptyState
        icon={SearchX}
        title="Diagnóstico não encontrado nesta empresa"
        description="Pode pertencer a outra empresa ou ter sido removido."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/plano">Abrir o mais recente</Link>
          </Button>
        }
      />
    ) : (
      <ErrorBanner
        title="Não foi possível carregar o diagnóstico."
        message={errorMessage(assessment.error)}
        onRetry={() => void assessment.refetch()}
        retrying={assessment.isFetching}
      />
    );
  }

  const detail = assessment.data;
  // O diagnóstico já traz as tarefas: indicadores e impressão não esperam pela lista.
  const currentTasks = tasks.data ?? detail.tasks;

  return (
    <div className="space-y-4">
      <PlanHeader detail={detail} history={history.data ?? []} />
      <ExecutiveScoreboard assessment={detail} tasks={currentTasks} />
      <GapMatrix assessment={detail} />
      <TaskManagementBoard assessment={detail} tasksQuery={tasks} />
      <ExecutivePrintView assessment={detail} tasks={currentTasks} />
    </div>
  );
}

function PlanHeader({ detail, history }: { detail: AssessmentDetail; history: AssessmentListEntry[] }) {
  const navigate = useNavigate();
  const { company } = detail;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">Plano de ação</p>
        <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight text-slate-900">{company.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
          <span>
            NIF <span className="font-mono tabular-nums text-slate-900">{company.nif}</span>
          </span>
          {company.cae && (
            <span>
              CAE <span className="font-mono tabular-nums text-slate-900">{company.cae}</span>
            </span>
          )}
          <Badge tone="outline">{sectorLabel(detail.sectorProfile)}</Badge>
          <span>
            Diagnóstico de <span className="font-mono tabular-nums text-slate-900">{formatDatePt(detail.snapshot.baseDate)}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {history.length > 1 && (
          <Select
            aria-label="Histórico de diagnósticos"
            containerClassName="w-64"
            className="h-8 text-xs"
            value={detail.id}
            onChange={(event) => navigate(`/plano/${event.target.value}`)}
          >
            {history.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {formatDatePt(entry.createdAt.slice(0, 10))} · score {entry.riskScore} · {formatEUR(entry.commercialRevenueAtRisk)}
              </option>
            ))}
          </Select>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to="/">
            <FilePlus2 aria-hidden /> Novo diagnóstico
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer aria-hidden /> Exportar Resumo Executivo (1 Página / PDF)
        </Button>
      </div>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="A carregar plano de ação">
      <div className="space-y-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-3 w-96" />
      </div>
      <ExecutiveScoreboardSkeleton />
      <GapMatrixSkeleton />
    </div>
  );
}
