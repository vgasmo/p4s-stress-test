// Acompanhamento de execução (vista secundária). Arrastar um cartão muda o estado;
// o seletor em cada cartão faz o mesmo para quem usa teclado.

import { useState } from 'react';
import { TASK_STATUSES, type Task, type TaskStatus } from '@engine/models/domain';
import { countsTowardsProposal } from '@engine/services/remediation-summary';
import { Select } from '@/components/ui/form';
import { STATUS_LABELS, formatDatePt, formatEUR } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ExecutorBadge, PriorityBadge } from './TaskBadges';
import { isOverdue } from './task-rules';

interface ExecutionKanbanProps {
  tasks: Task[];
  today: string;
  /** Nome do responsável de cada tarefa, por id de utilizador. */
  assigneeNames: ReadonlyMap<string, string>;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onOpen: (task: Task) => void;
}

export function ExecutionKanban({ tasks, today, assigneeNames, onStatusChange, onOpen }: ExecutionKanbanProps) {
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((status) => {
        const column = tasks.filter((task) => task.status === status);
        return (
          <section
            key={status}
            aria-label={STATUS_LABELS[status]}
            onDragOver={(event) => {
              event.preventDefault();
              setDropTarget(status);
            }}
            onDragLeave={() => setDropTarget((current) => (current === status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              const task = tasks.find((t) => t.id === event.dataTransfer.getData('text/plain'));
              if (task && task.status !== status) onStatusChange(task, status);
            }}
            className={cn(
              'flex min-h-40 flex-col rounded-md border bg-slate-50 transition-colors',
              dropTarget === status ? 'border-slate-900 bg-slate-100' : 'border-slate-200',
            )}
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <h3 className="text-xs font-semibold text-slate-900">{STATUS_LABELS[status]}</h3>
              <span className="font-mono text-2xs tabular-nums text-slate-600">{column.length}</span>
            </header>
            <ul className="flex flex-1 flex-col gap-2 p-2">
              {column.length === 0 && <li className="px-1 py-2 text-xs text-slate-600">Sem tarefas.</li>}
              {column.map((task) => {
                const overdue = isOverdue(task, today);
                return (
                  <li
                    key={task.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', task.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    className={cn(
                      'cursor-grab rounded-md border border-slate-200 bg-white p-2.5 transition-colors hover:border-slate-400 active:cursor-grabbing',
                      !task.includedInProposal && 'border-dashed',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(task)}
                      className="line-clamp-2 rounded text-left text-sm font-medium text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                    >
                      {task.title}
                    </button>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <PriorityBadge priority={task.priority} />
                      <ExecutorBadge executor={task.executorType} short />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                      <span className={cn('font-mono tabular-nums', overdue ? 'font-semibold text-rose-700' : 'text-slate-700')}>
                        {overdue ? 'Em atraso · ' : ''}
                        {formatDatePt(task.deadline)}
                      </span>
                      {/* Só os honorários que contam para a proposta: os cartões somam o mesmo que o topo. */}
                      {countsTowardsProposal(task) ? (
                        <span className="font-mono tabular-nums text-slate-900">{formatEUR(task.estimatedCost)}</span>
                      ) : (
                        <span className="text-slate-600">{task.executorType === 'internal' ? 'Interno' : 'Fora da proposta'}</span>
                      )}
                    </div>
                    {task.assignedUserId && assigneeNames.has(task.assignedUserId) && (
                      <p className="mt-1 truncate text-xs text-slate-600">Responsável: {assigneeNames.get(task.assignedUserId)}</p>
                    )}
                    <Select
                      aria-label={`Mover «${task.title}»`}
                      containerClassName="mt-2"
                      className="h-7 text-xs"
                      value={task.status}
                      onChange={(event) => onStatusChange(task, event.target.value as TaskStatus)}
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
