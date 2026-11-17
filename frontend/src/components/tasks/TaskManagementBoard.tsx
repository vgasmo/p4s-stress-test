// Plano de ação: vista principal «Configurador de plano e orçamento» (fechar âmbito,
// executor e preço na reunião) e vista secundária de acompanhamento em kanban.

import type { UseQueryResult } from '@tanstack/react-query';
import { ClipboardCheck, Columns3, FilterX, Plus, Rows3 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssessmentDetail } from '@engine/models/api.types';
import type { Task } from '@engine/models/domain';
import type { UpdateTaskInput } from '@engine/models/schemas';
import { todayInLisbon } from '@engine/utils/dates';
import { FailedChangesNotice } from '@/components/layout/FailedChangesNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAssignableUsers } from '@/hooks/useAuth';
import { useTaskChanges } from '@/hooks/useTasks';
import { errorMessage } from '@/lib/api';
import { keepFocusAfterRedraw } from '@/lib/focus';
import { isStaffSession, useSession } from '@/lib/session';
import { readStorage, writeStorage } from '@/lib/utils';
import { ExecutionKanban } from './ExecutionKanban';
import { ProposalConfigurator } from './ProposalConfigurator';
import { EMPTY_FILTERS, TaskFilterBar, applyTaskFilters, hasActiveFilters, type TaskFilters } from './TaskFilterBar';
import { TaskSheetForm } from './TaskSheetForm';

interface TaskManagementBoardProps {
  assessment: AssessmentDetail;
  tasksQuery: UseQueryResult<Task[], Error>;
}

type PlanTab = 'proposal' | 'execution';
const TAB_KEY = 'p4s.plan-tab';

/**
 * Separador com que o plano abre: o último que a pessoa usou. Na primeira vez, a conta de
 * uma empresa num ecrã estreito abre no acompanhamento, onde o estado, o prazo e os
 * honorários de cada tarefa cabem no ecrã (a tabela da proposta obriga a deslizar para o lado).
 */
function initialTab(staff: boolean): PlanTab {
  const remembered = readStorage<string>('local', TAB_KEY);
  if (remembered === 'proposal' || remembered === 'execution') return remembered;
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  return !staff && narrow ? 'execution' : 'proposal';
}

export function TaskManagementBoard({ assessment, tasksQuery }: TaskManagementBoardProps) {
  const session = useSession();
  const staff = isStaffSession(session);
  // Alterações feitas na tabela e no kanban, e as que o servidor não gravou.
  const changes = useTaskChanges(assessment.id);
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const [sheet, setSheet] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [tab, setTab] = useState<PlanTab>(() => initialTab(staff));
  const chooseTab = (value: string) => {
    if (value !== 'proposal' && value !== 'execution') return;
    setTab(value);
    writeStorage('local', TAB_KEY, value);
  };
  const today = todayInLisbon();

  const patchTask = (task: Task, patch: UpdateTaskInput) => {
    // No kanban o cartão muda de coluna e é redesenhado: o foco passa para o seletor do cartão novo.
    keepFocusAfterRedraw();
    changes.change(task, patch);
  };
  const openTask = (task: Task | null) => setSheet({ open: true, task });

  const allTasks = tasksQuery.data ?? [];
  const visible = applyTaskFilters(allTasks, filters);
  const assignable = useAssignableUsers();
  const assigneeNames = new Map((assignable.data ?? []).map((user) => [user.id, user.fullName]));
  // Mantém o painel sincronizado com a versão mais recente da tarefa aberta.
  const sheetTask = sheet.task ? (allTasks.find((t) => t.id === sheet.task?.id) ?? sheet.task) : null;

  return (
    <Card>
      <CardHeader className="items-center">
        <div>
          <CardTitle>Plano de ação e orçamento</CardTitle>
          <CardDescription>
            {staff
              ? 'Ligue, desligue ou passe a interno cada entregável. Os totais no topo atualizam no momento.'
              : 'Pode atualizar o estado e o responsável de cada tarefa e acrescentar tarefas internas. O âmbito, o prazo, o executor e os honorários dos entregáveis são definidos pela P4S.'}
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => openTask(null)} disabled={!tasksQuery.isSuccess}>
          <Plus aria-hidden /> Nova tarefa
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <FailedChangesNotice changes={changes} />

        {tasksQuery.isPending ? (
          <BoardSkeleton />
        ) : tasksQuery.isError ? (
          <ErrorBanner
            title="Não foi possível carregar as tarefas."
            message={errorMessage(tasksQuery.error)}
            onRetry={() => void tasksQuery.refetch()}
            retrying={tasksQuery.isFetching}
          />
        ) : allTasks.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Sem tarefas neste plano"
            description={
              staff
                ? 'O diagnóstico não encontrou lacunas no âmbito avaliado, ou os entregáveis foram eliminados. Pode acrescentar uma tarefa ou fazer um novo diagnóstico.'
                : 'O diagnóstico não encontrou lacunas no âmbito avaliado. Pode acrescentar tarefas internas.'
            }
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openTask(null)}>
                  <Plus aria-hidden /> Nova tarefa
                </Button>
                {staff && (
                  <Button asChild size="sm">
                    <Link to="/">Novo diagnóstico</Link>
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <Tabs value={tab} onValueChange={chooseTab}>
            <TabsList>
              <TabsTrigger value="proposal">
                <Rows3 aria-hidden />
                <span className="sm:hidden">Proposta</span>
                <span className="hidden sm:inline">{staff ? 'Configurador de plano e orçamento' : 'Plano e orçamento'}</span>
              </TabsTrigger>
              <TabsTrigger value="execution">
                <Columns3 aria-hidden />
                <span className="sm:hidden">Execução</span>
                <span className="hidden sm:inline">Acompanhamento de execução</span>
              </TabsTrigger>
            </TabsList>
            <div className="py-3">
              <TaskFilterBar filters={filters} onChange={setFilters} shown={visible.length} total={allTasks.length} />
            </div>
            {visible.length === 0 && hasActiveFilters(filters) ? (
              <EmptyState
                icon={FilterX}
                title="Nenhuma tarefa corresponde aos filtros"
                description="Os totais do topo continuam a contar todas as tarefas do plano."
                action={
                  <Button size="sm" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <>
                <TabsContent value="proposal">
                  <ProposalConfigurator
                    tasks={visible}
                    allTasks={allTasks}
                    staff={staff}
                    today={today}
                    assessment={assessment}
                    filtered={hasActiveFilters(filters)}
                    assigneeNames={assigneeNames}
                    onPatch={patchTask}
                    onOpen={openTask}
                  />
                </TabsContent>
                <TabsContent value="execution">
                  <ExecutionKanban
                    tasks={visible}
                    today={today}
                    assigneeNames={assigneeNames}
                    onStatusChange={(task, status) => patchTask(task, { status })}
                    onOpen={openTask}
                  />
                </TabsContent>
              </>
            )}
          </Tabs>
        )}
      </CardContent>

      <TaskSheetForm
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        task={sheetTask}
        assessment={assessment}
        staff={staff}
      />
    </Card>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="A carregar tarefas">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-52" />
      </div>
      {Array.from({ length: 2 }, (_, section) => (
        <div key={section} className="overflow-hidden rounded-md border border-slate-200">
          <div className="flex justify-between bg-slate-50 px-3 py-2.5">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-28" />
          </div>
          {Array.from({ length: section === 0 ? 3 : 2 }, (_, row) => (
            <div key={row} className="flex items-center gap-4 border-t border-slate-200 px-3 py-3">
              <Skeleton className="h-5 w-9 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
