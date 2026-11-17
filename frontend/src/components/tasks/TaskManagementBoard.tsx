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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUpdateTask } from '@/hooks/useTasks';
import { errorMessage } from '@/lib/api';
import { isStaffSession, useSession } from '@/lib/session';
import { ExecutionKanban } from './ExecutionKanban';
import { ProposalConfigurator } from './ProposalConfigurator';
import { EMPTY_FILTERS, TaskFilterBar, applyTaskFilters, hasActiveFilters, type TaskFilters } from './TaskFilterBar';
import { TaskSheetForm } from './TaskSheetForm';

interface TaskManagementBoardProps {
  assessment: AssessmentDetail;
  tasksQuery: UseQueryResult<Task[], Error>;
}

interface FailedPatch {
  task: Task;
  patch: UpdateTaskInput;
  message: string;
}

export function TaskManagementBoard({ assessment, tasksQuery }: TaskManagementBoardProps) {
  const session = useSession();
  const staff = isStaffSession(session);
  const update = useUpdateTask(assessment.id);
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const [sheet, setSheet] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [failed, setFailed] = useState<FailedPatch | null>(null);
  const today = todayInLisbon();

  const patchTask = (task: Task, patch: UpdateTaskInput) => {
    setFailed(null);
    update.mutate({ id: task.id, patch }, { onError: (error) => setFailed({ task, patch, message: errorMessage(error) }) });
  };
  const openTask = (task: Task | null) => setSheet({ open: true, task });

  const allTasks = tasksQuery.data ?? [];
  const visible = applyTaskFilters(allTasks, filters);
  // Mantém o painel sincronizado com a versão mais recente da tarefa aberta.
  const sheetTask = sheet.task ? (allTasks.find((t) => t.id === sheet.task?.id) ?? sheet.task) : null;

  return (
    <Card>
      <CardHeader className="items-center">
        <div>
          <CardTitle>Plano de ação e orçamento</CardTitle>
          <CardDescription>Ligue, desligue ou passe a interno cada entregável. Os totais no topo atualizam no momento.</CardDescription>
        </div>
        <Button size="sm" onClick={() => openTask(null)} disabled={!tasksQuery.isSuccess}>
          <Plus aria-hidden /> Nova tarefa
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed && (
          <ErrorBanner
            title="A alteração não foi guardada e foi revertida."
            message={failed.message}
            onRetry={() => patchTask(failed.task, failed.patch)}
            retrying={update.isPending}
          />
        )}

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
            description="O diagnóstico não encontrou lacunas no âmbito avaliado. Pode acrescentar uma tarefa ou fazer um novo stress test."
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openTask(null)}>
                  <Plus aria-hidden /> Nova tarefa
                </Button>
                <Button asChild size="sm">
                  <Link to="/">Iniciar Primeiro Stress Test</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <Tabs defaultValue="proposal">
            <TabsList>
              <TabsTrigger value="proposal">
                <Rows3 aria-hidden />
                <span className="sm:hidden">Proposta</span>
                <span className="hidden sm:inline">Configurador de plano e orçamento</span>
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
                    onPatch={patchTask}
                    onOpen={openTask}
                  />
                </TabsContent>
                <TabsContent value="execution">
                  <ExecutionKanban
                    tasks={visible}
                    today={today}
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
