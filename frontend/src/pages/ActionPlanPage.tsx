import { Building2, ClipboardList, FilePlus2, FileWarning, Info, Pencil, Printer, RefreshCw, SearchX, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { AssessmentDetail, AssessmentListEntry } from '@engine/models/api.types';
import { CompanySheet } from '@/components/company/CompanySheet';
import { ExecutiveScoreboard, ExecutiveScoreboardSkeleton } from '@/components/dashboard/ExecutiveScoreboard';
import { GapMatrix, GapMatrixSkeleton } from '@/components/dashboard/GapMatrix';
import { PlanProgress } from '@/components/dashboard/PlanProgress';
import { ExecutivePrintView } from '@/components/print/ExecutivePrintView';
import { TaskManagementBoard } from '@/components/tasks/TaskManagementBoard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { useAssessment, useAssessments, useDeleteAssessment, useReissueProposal } from '@/hooks/useAssessment';
import { useTasks } from '@/hooks/useTasks';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDatePt, formatDateTimePt, formatEUR, formatPercent, sectorLabel, todayInLisbon } from '@/lib/formatters';
import { printWithTitle } from '@/lib/print';
import { isStaffSession, useSession } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que o wizard passa ao abrir o plano depois de gravar (estado da navegação). */
export interface PlanNavigationState {
  /** O NIF indicado já existia: o diagnóstico ficou na empresa registada, com o nome que lá estava. */
  existingCompany?: { typedName: string };
}

export function ActionPlanPage() {
  const { assessmentId } = useParams();
  const session = useSession();
  const staff = isStaffSession(session);
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
        title={staff ? 'Escolha a empresa cliente' : 'Sessão sem empresa associada'}
        description={
          staff
            ? 'Selecione a empresa no topo ou faça um stress test novo e registe-a por NIF e nome.'
            : 'A sua conta não tem empresa. Fale com a equipa P4S.'
        }
        action={
          staff ? (
            <Button asChild size="sm">
              <Link to="/">Iniciar Primeiro Stress Test</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  // Só identificadores chegam à API: um endereço construído à mão volta ao plano mais recente.
  if (belongsToPreviousCompany || (assessmentId !== undefined && !UUID.test(assessmentId))) {
    return <Navigate to="/plano" replace />;
  }

  return assessmentId ? <ActionPlan assessmentId={assessmentId} staff={staff} /> : <LatestAssessment staff={staff} />;
}

/** /plano sem id: abre o diagnóstico mais recente da empresa que se consegue abrir. */
function LatestAssessment({ staff }: { staff: boolean }) {
  const assessments = useAssessments();
  const latest = assessments.data?.find((entry) => entry.openable);

  if (latest) return <Navigate to={`/plano/${latest.id}`} replace />;
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

  const onlyUnopenable = assessments.data.length > 0;
  return (
    <EmptyState
      icon={ClipboardList}
      title={onlyUnopenable ? 'Os diagnósticos desta empresa não se conseguem abrir' : 'Ainda não há diagnósticos para esta empresa'}
      description={
        staff
          ? onlyUnopenable
            ? 'Foram gravados por uma versão anterior da ferramenta. Faça um novo diagnóstico para gerar o plano de ação.'
            : 'O stress test demora cerca de 5 minutos e gera o plano de ação com preço e prazo fechados.'
          : 'O plano aparece aqui depois de o seu consultor Plan4Sustain gravar o diagnóstico. Entretanto pode ver a ordem de grandeza na simulação.'
      }
      action={
        <Button asChild size="sm" variant={staff ? 'default' : 'outline'}>
          <Link to="/">{staff ? 'Iniciar Primeiro Stress Test' : 'Abrir a simulação'}</Link>
        </Button>
      }
    />
  );
}

function ActionPlan({ assessmentId, staff }: { assessmentId: string; staff: boolean }) {
  const assessment = useAssessment(assessmentId);
  const tasks = useTasks(assessmentId);
  const history = useAssessments();

  if (assessment.isPending) return <PlanSkeleton />;

  if (assessment.isError) {
    const error = assessment.error;
    if (error instanceof ApiError && error.status === 404) {
      return (
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
      );
    }
    if (error instanceof ApiError && error.code === 'ASSESSMENT_NOT_OPENABLE') {
      return (
        <EmptyState
          icon={FileWarning}
          title="Este diagnóstico não se consegue abrir"
          description={error.message}
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/plano">Abrir o mais recente</Link>
              </Button>
              {staff && <DeleteAssessmentButton assessmentId={assessmentId} />}
            </div>
          }
        />
      );
    }
    return (
      <ErrorBanner
        title="Não foi possível carregar o diagnóstico."
        message={errorMessage(error)}
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
      <PlanHeader detail={detail} history={history.data ?? []} staff={staff} taskCount={currentTasks.length} />
      <ExistingCompanyNotice detail={detail} />
      <ProposalValidity detail={detail} staff={staff} />
      <ExecutiveScoreboard assessment={detail} tasks={currentTasks} />
      <PlanProgress tasks={currentTasks} today={todayInLisbon()} />
      <GapMatrix assessment={detail} tasks={currentTasks} staff={staff} />
      <TaskManagementBoard assessment={detail} tasksQuery={tasks} />
      <ExecutivePrintView assessment={detail} tasks={currentTasks} />
    </div>
  );
}

interface PlanHeaderProps {
  detail: AssessmentDetail;
  history: AssessmentListEntry[];
  staff: boolean;
  /** Tarefas que o plano tem agora (o que se perde ao eliminar o diagnóstico). */
  taskCount: number;
}

function PlanHeader({ detail, history, staff, taskCount }: PlanHeaderProps) {
  const navigate = useNavigate();
  const [editingCompany, setEditingCompany] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const { company, proposal } = detail;

  const cancelDelete = () => {
    setConfirmingDelete(false);
    // O botão volta a estar ativo depois de o ecrã atualizar: só então pode receber o foco.
    requestAnimationFrame(() => deleteButton.current?.focus());
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">Plano de ação</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900">{company.name}</h1>
            {staff && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditingCompany(true)}
                aria-label="Editar dados da empresa"
                title="Editar dados da empresa"
              >
                <Pencil aria-hidden />
              </Button>
            )}
          </div>
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
              {detail.conductedByName ? `, por ${detail.conductedByName}` : ''}
            </span>
            {!proposal.expired && (
              <span data-testid="proposal-dates">
                Proposta válida até <span className="font-mono tabular-nums text-slate-900">{formatDatePt(proposal.validUntil)}</span>
              </span>
            )}
          </div>
          {/* Os dados de partida do cálculo, para se poder conferir o número e repetir o diagnóstico. */}
          <p className="mt-1 text-xs text-slate-600" data-testid="plan-inputs">
            Calculado com faturação anual de{' '}
            <span className="font-mono tabular-nums text-slate-900">{formatEUR(detail.snapshot.input.annualRevenue)}</span>, dos quais{' '}
            <span className="font-mono tabular-nums text-slate-900">{formatPercent(detail.snapshot.input.topClientsShare)}</span> nos 3
            maiores clientes
            {detail.creditLineToRefinance > 0 && (
              <>
                , e <span className="font-mono tabular-nums text-slate-900">{formatEUR(detail.creditLineToRefinance)}</span> de crédito a
                refinanciar
              </>
            )}
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:flex-nowrap">
          {history.length > 1 && (
            <Select
              aria-label="Histórico de diagnósticos"
              containerClassName="w-64"
              className="h-8 text-xs"
              value={detail.id}
              onChange={(event) => navigate(`/plano/${event.target.value}`)}
            >
              {history.map((entry) => (
                <option key={entry.id} value={entry.id} disabled={!entry.openable}>
                  {formatDateTimePt(entry.createdAt)}
                  {entry.openable
                    ? ` · ${formatEUR(entry.commercialRevenueAtRisk)} em risco · ${entry.taskCount} ${entry.taskCount === 1 ? 'tarefa' : 'tarefas'}${
                        entry.conductedByName ? ` · ${entry.conductedByName}` : ''
                      }`
                    : ' · versão anterior, não abre'}
                </option>
              ))}
            </Select>
          )}
          {staff && (
            <Button asChild variant="outline" size="sm">
              <Link to="/">
                <FilePlus2 aria-hidden /> Novo diagnóstico
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => printWithTitle(`Resumo executivo · ${company.name} · ${formatDatePt(proposal.issuedOn).replaceAll('/', '-')}`)}
          >
            <Printer aria-hidden /> Exportar Resumo Executivo (1 Página / PDF)
          </Button>
          {staff && (
            <Button
              ref={deleteButton}
              variant="ghost"
              size="icon"
              onClick={() => setConfirmingDelete(true)}
              disabled={confirmingDelete}
              aria-label="Eliminar este diagnóstico"
              title="Eliminar este diagnóstico"
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
        {staff && <CompanySheet open={editingCompany} onOpenChange={setEditingCompany} company={company} />}
      </div>
      {staff && confirmingDelete && (
        <DeleteAssessmentConfirmation assessmentId={detail.id} taskCount={taskCount} onCancel={cancelDelete} />
      )}
    </div>
  );
}

/** Depois de gravar com um NIF que já existia: diz que empresa ficou com o diagnóstico. */
function ExistingCompanyNotice({ detail }: { detail: AssessmentDetail }) {
  const location = useLocation();
  const state = location.state as PlanNavigationState | null;
  const [dismissed, setDismissed] = useState(false);
  const typedName = state?.existingCompany?.typedName;
  if (!typedName || dismissed) return null;

  const sameName = typedName.trim().toLowerCase() === detail.company.name.trim().toLowerCase();
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-sky-950">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-sky-700" />
      <p className="min-w-0 flex-1 text-sm">
        Já existia uma empresa com o NIF <span className="font-mono tabular-nums">{detail.company.nif}</span>
        {sameName ? '.' : `, registada como «${detail.company.name}».`} O diagnóstico ficou associado a ela
        {sameName ? '.' : ` e o nome «${typedName}» não foi gravado. Se for esse o nome certo, corrija-o em «Editar dados da empresa».`}
      </p>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        Fechar
      </Button>
    </div>
  );
}

/** A validade conta da data de emissão guardada. Passado o prazo, só a P4S volta a emitir. */
function ProposalValidity({ detail, staff }: { detail: AssessmentDetail; staff: boolean }) {
  const reissue = useReissueProposal(detail.id);
  if (!detail.proposal.expired) return null;

  return (
    <div
      role="status"
      data-testid="proposal-expired"
      className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          A proposta expirou em <span className="font-mono tabular-nums">{formatDatePt(detail.proposal.validUntil)}</span>.
        </p>
        <p className="text-xs text-amber-900">
          {staff
            ? 'Os honorários e os prazos deixaram de estar garantidos. Ao reemitir, a validade recomeça hoje e os entregáveis por começar deslizam os mesmos dias.'
            : 'Os honorários e os prazos deixaram de estar garantidos. Peça a reemissão ao seu consultor Plan4Sustain.'}
        </p>
        {reissue.isError && <p className="mt-1 text-xs font-medium text-rose-800">{errorMessage(reissue.error)}</p>}
      </div>
      {staff && (
        <Button size="sm" className="shrink-0" onClick={() => reissue.mutate()} disabled={reissue.isPending}>
          <RefreshCw aria-hidden /> {reissue.isPending ? 'A reemitir…' : 'Reemitir proposta com a data de hoje'}
        </Button>
      )}
    </div>
  );
}

/** Eliminar um diagnóstico (de teste ou enganado) pede confirmação: leva as tarefas com ele. */
function useDeleteAndLeave(assessmentId: string) {
  const navigate = useNavigate();
  const remove = useDeleteAssessment();
  return {
    remove,
    run: () => remove.mutate(assessmentId, { onSuccess: () => navigate('/plano', { replace: true }) }),
  };
}

/** Faixa de confirmação no plano aberto: diz o que se perde antes de pedir o segundo clique. */
function DeleteAssessmentConfirmation({
  assessmentId,
  taskCount,
  onCancel,
}: {
  assessmentId: string;
  taskCount: number;
  onCancel: () => void;
}) {
  const { remove, run } = useDeleteAndLeave(assessmentId);
  return (
    <div
      role="group"
      aria-label="Confirmar eliminação do diagnóstico"
      data-testid="delete-assessment-confirmation"
      className="flex flex-col gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-950 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Eliminar este diagnóstico?</p>
        <p className="text-xs text-rose-900">
          {taskCount === 0
            ? 'O diagnóstico deixa de existir. Não se consegue recuperar.'
            : `O diagnóstico e ${taskCount === 1 ? 'a tarefa' : `as ${taskCount} tarefas`} do plano deixam de existir. Não se consegue recuperar.`}
        </p>
        {remove.isError && <p className="mt-1 text-xs font-medium text-rose-800">{errorMessage(remove.error)}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={run}>
          <Trash2 aria-hidden /> {remove.isPending ? 'A eliminar…' : 'Eliminar diagnóstico e tarefas'}
        </Button>
        <Button variant="outline" size="sm" disabled={remove.isPending} onClick={onCancel} autoFocus>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Num diagnóstico que não abre só há o botão: pede confirmação no próprio sítio. */
function DeleteAssessmentButton({ assessmentId }: { assessmentId: string }) {
  const { remove, run } = useDeleteAndLeave(assessmentId);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden /> Eliminar este diagnóstico
      </Button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar eliminação do diagnóstico">
      <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={run}>
        <Trash2 aria-hidden /> {remove.isPending ? 'A eliminar…' : 'Eliminar diagnóstico e tarefas'}
      </Button>
      <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => setConfirming(false)}>
        Cancelar
      </Button>
      {remove.isError && <span className="text-xs font-medium text-rose-800">{errorMessage(remove.error)}</span>}
    </span>
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
