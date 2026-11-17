// Andamento do plano: o que quem entra para o acompanhar quer saber primeiro.

import type { Task } from '@engine/models/domain';
import { planProgress } from '@engine/services/plan-coverage';
import { formatDatePt } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export function PlanProgress({ tasks, today }: { tasks: Task[]; today: string }) {
  const progress = planProgress(tasks, today);
  if (progress.total === 0) return null;
  const done = progress.completed === progress.total;

  return (
    <section
      aria-label="Andamento do plano"
      data-testid="plan-progress"
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4"
    >
      <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">Andamento</p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
        aria-label={`${progress.completed} de ${progress.total} tarefas concluídas`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 sm:w-40"
      >
        <div
          className={cn('h-full rounded-full', done ? 'bg-emerald-600' : 'bg-slate-900')}
          style={{ width: `${(progress.completed / progress.total) * 100}%` }}
        />
      </div>
      <p className="min-w-0 flex-1 text-xs text-slate-700">
        <span className="font-mono tabular-nums text-slate-900">
          {progress.completed} de {progress.total}
        </span>{' '}
        {progress.total === 1 ? 'tarefa concluída' : 'tarefas concluídas'}
        {progress.inProgress > 0 && (
          <>
            {' '}
            · <span className="font-mono tabular-nums text-slate-900">{progress.inProgress}</span> em curso
          </>
        )}
        {progress.overdue > 0 && (
          <>
            {' '}
            ·{' '}
            <span className="font-medium text-rose-700">
              <span className="font-mono tabular-nums">{progress.overdue}</span> em atraso
            </span>
          </>
        )}
        {progress.next && (
          <>
            {' '}
            · próximo prazo <span className="font-mono tabular-nums text-slate-900">{formatDatePt(progress.next.deadline)}</span> (
            {progress.next.title})
          </>
        )}
        {done && ' · tudo concluído. Um novo diagnóstico atualiza a faturação em risco.'}
      </p>
    </section>
  );
}
