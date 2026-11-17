import { X } from 'lucide-react';
import {
  TASK_DOMAINS,
  TASK_EXECUTORS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskDomain,
  type TaskExecutor,
  type TaskPriority,
  type TaskStatus,
} from '@engine/models/domain';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { DOMAIN_LABELS, EXECUTOR_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/formatters';

export interface TaskFilters {
  status: TaskStatus | '';
  domain: TaskDomain | '';
  priority: TaskPriority | '';
  executorType: TaskExecutor | '';
}

export const EMPTY_FILTERS: TaskFilters = { status: '', domain: '', priority: '', executorType: '' };

export function applyTaskFilters(tasks: Task[], filters: TaskFilters): Task[] {
  return tasks.filter(
    (task) =>
      (!filters.status || task.status === filters.status) &&
      (!filters.domain || task.domain === filters.domain) &&
      (!filters.priority || task.priority === filters.priority) &&
      (!filters.executorType || task.executorType === filters.executorType),
  );
}

export const hasActiveFilters = (filters: TaskFilters) => Object.values(filters).some(Boolean);

interface TaskFilterBarProps {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  shown: number;
  total: number;
}

export function TaskFilterBar({ filters, onChange, shown, total }: TaskFilterBarProps) {
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filtrar tarefas">
      <FilterSelect label="Estado" value={filters.status} onChange={(v) => set('status', v as TaskStatus | '')}>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect label="Domínio" value={filters.domain} onChange={(v) => set('domain', v as TaskDomain | '')}>
        {TASK_DOMAINS.map((d) => (
          <option key={d} value={d}>
            {DOMAIN_LABELS[d]}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect label="Prioridade" value={filters.priority} onChange={(v) => set('priority', v as TaskPriority | '')}>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect label="Executor" value={filters.executorType} onChange={(v) => set('executorType', v as TaskExecutor | '')}>
        {TASK_EXECUTORS.map((e) => (
          <option key={e} value={e}>
            {EXECUTOR_LABELS[e]}
          </option>
        ))}
      </FilterSelect>
      {hasActiveFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <X aria-hidden /> Limpar
        </Button>
      )}
      <span className="ml-auto font-mono text-xs tabular-nums text-slate-600">
        {shown}/{total} tarefas
      </span>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} containerClassName="w-40" className="h-8 text-xs">
      <option value="">{label}: todos</option>
      {children}
    </Select>
  );
}
