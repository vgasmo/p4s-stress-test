import type { TaskDomain, TaskExecutor, TaskPriority } from '@engine/models/domain';
import { Badge } from '@/components/ui/badge';
import { EXECUTOR_LABELS, EXECUTOR_SHORT_LABELS, PRIORITY_LABELS } from '@/lib/formatters';

const PRIORITY_TONE = {
  critical: 'critical',
  high: 'high',
  medium: 'neutral',
  low: 'outline',
} as const satisfies Record<TaskPriority, string>;

const EXECUTOR_TONE = {
  p4s: 'p4s',
  partner: 'partner',
  internal: 'neutral',
} as const satisfies Record<TaskExecutor, string>;

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function ExecutorBadge({ executor, short = false }: { executor: TaskExecutor; short?: boolean }) {
  return <Badge tone={EXECUTOR_TONE[executor]}>{(short ? EXECUTOR_SHORT_LABELS : EXECUTOR_LABELS)[executor]}</Badge>;
}

/** Executor com preço fechado para o domínio: segurança da informação vai para o parceiro. */
export function pricedExecutorFor(domain: TaskDomain): Exclude<TaskExecutor, 'internal'> {
  return domain === 'information_security' ? 'partner' : 'p4s';
}
