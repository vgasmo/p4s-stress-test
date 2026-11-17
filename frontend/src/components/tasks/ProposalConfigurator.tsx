// Vista principal do plano: configurar âmbito, executor e preço da proposta em reunião.
// Cada alteração é otimista: os totais no topo mudam no mesmo frame.

import { Lock, Pencil } from 'lucide-react';
import type { AssessmentDetail } from '@engine/models/api.types';
import { TASK_STATUSES, type Task, type TaskPhase } from '@engine/models/domain';
import type { UpdateTaskInput } from '@engine/models/schemas';
import { countsTowardsProposal, summarizeRemediation } from '@engine/services/remediation-summary';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DOMAIN_LABELS,
  EXECUTOR_SHORT_LABELS,
  PHASE_SHORT_LABELS,
  STATUS_LABELS,
  formatDatePt,
  formatEUR,
  phaseLabel,
  phaseWindowText,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { PriorityBadge, pricedExecutorFor } from './TaskBadges';
import { canEditProposalTerms, isAfterPhaseWindow, isOverdue, phaseEndDate, requiredByOf } from './task-rules';

const PHASES: TaskPhase[] = ['phase_1_urgent', 'phase_2_structural'];

// Larguras fixas: as colunas ficam alinhadas entre a tabela da Fase 1 e a da Fase 2.
const COLUMNS = (
  <colgroup>
    <col className="w-16" />
    <col />
    <col className="w-20" />
    <col className="w-44" />
    <col className="w-24" />
    <col className="w-36" />
    <col className="w-28" />
    <col className="w-14" />
  </colgroup>
);

interface ProposalConfiguratorProps {
  /** Tarefas visíveis (depois dos filtros). */
  tasks: Task[];
  /** Todas as tarefas do plano, para os subtotais não mudarem com os filtros. */
  allTasks: Task[];
  staff: boolean;
  today: string;
  /** Diagnóstico a que o plano pertence: dá o remetente de cada entregável e a data de emissão da proposta. */
  assessment: AssessmentDetail;
  onPatch: (task: Task, patch: UpdateTaskInput) => void;
  onOpen: (task: Task) => void;
}

export function ProposalConfigurator({ tasks, allTasks, staff, today, assessment, onPatch, onOpen }: ProposalConfiguratorProps) {
  const summary = summarizeRemediation(allTasks, 0);
  // As janelas das fases contam a partir da data de emissão da proposta.
  const baseDate = assessment.proposal.issuedOn;

  return (
    <div className="space-y-5">
      {PHASES.map((phase) => {
        const rows = tasks.filter((task) => task.phase === phase);
        const subtotal = phase === 'phase_1_urgent' ? summary.phase1Cost : summary.phase2Cost;
        return (
          <section key={phase} aria-label={phaseLabel(phase)} className="overflow-hidden rounded-md border border-slate-200">
            <div className="flex items-baseline justify-between gap-3 bg-slate-50 px-3 py-2">
              <h3 className="text-xs font-semibold text-slate-900">
                {phaseLabel(phase)}{' '}
                <span className="font-mono font-normal tabular-nums text-slate-600">· {phaseWindowText(phase)}</span>
              </h3>
              <p className="text-xs text-slate-700">
                Investimento {PHASE_SHORT_LABELS[phase]}{' '}
                <span data-testid={`subtotal-${phase}`} className="font-mono font-semibold tabular-nums text-slate-900">
                  {formatEUR(subtotal)}
                </span>
              </p>
            </div>
            {rows.length === 0 ? (
              <p className="border-t border-slate-200 px-3 py-3 text-xs text-slate-600">Sem tarefas nesta fase com os filtros atuais.</p>
            ) : (
              <Table className="min-w-[920px] table-fixed">
                {COLUMNS}
                <TableHeader className="bg-white">
                  <TableRow>
                    <TableHead>Incluir</TableHead>
                    <TableHead>Entregável</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Executor</TableHead>
                    <TableHead numeric>Prazo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead numeric>Honorários</TableHead>
                    <TableHead>
                      <span className="sr-only">Editar</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((task) => (
                    <ConfiguratorRow
                      key={task.id}
                      task={task}
                      staff={staff}
                      today={today}
                      baseDate={baseDate}
                      requiredBy={requiredByOf(task, assessment.snapshot)}
                      onPatch={onPatch}
                      onOpen={onOpen}
                    />
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs text-slate-700">
                      Subtotal {PHASE_SHORT_LABELS[phase]} (P4S + parceiro, incluídos na proposta)
                    </TableCell>
                    <TableCell numeric className="text-sm font-semibold text-slate-900">
                      {formatEUR(subtotal)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ConfiguratorRow({
  task,
  staff,
  today,
  baseDate,
  requiredBy,
  onPatch,
  onOpen,
}: {
  task: Task;
  staff: boolean;
  today: string;
  baseDate: string;
  requiredBy: string | null;
  onPatch: (task: Task, patch: UpdateTaskInput) => void;
  onOpen: (task: Task) => void;
}) {
  const editable = canEditProposalTerms(task, staff);
  const counts = countsTowardsProposal(task);
  const priced = pricedExecutorFor(task.domain);
  const overdue = isOverdue(task, today);
  const afterPhase = isAfterPhaseWindow(task, baseDate);
  const lockedTitle = editable ? undefined : 'Termos definidos pela P4S';

  return (
    <TableRow className={cn('transition-colors hover:bg-slate-50', !task.includedInProposal && 'bg-slate-50/70')}>
      <TableCell>
        <Switch
          checked={task.includedInProposal}
          disabled={!editable}
          title={lockedTitle}
          aria-label={`Incluir «${task.title}» na proposta`}
          onCheckedChange={(includedInProposal) => onPatch(task, { includedInProposal })}
        />
      </TableCell>
      <TableCell>
        <button
          type="button"
          onClick={() => onOpen(task)}
          className={cn(
            'rounded text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
            task.includedInProposal ? 'text-slate-900' : 'text-slate-600',
          )}
        >
          {task.title}
        </button>
        <p className="text-xs text-slate-600">
          {DOMAIN_LABELS[task.domain]}
          {requiredBy ? ` · exigido por ${requiredBy}` : ''}
          {!task.includedInProposal ? ' · fora da proposta' : ''}
        </p>
      </TableCell>
      <TableCell>
        <PriorityBadge priority={task.priority} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5" title={staff ? undefined : 'Executor definido pela P4S'}>
          <Segmented
            size="sm"
            label={`Executor de «${task.title}»`}
            value={task.executorType === 'internal' ? 'internal' : task.executorType}
            options={[
              { value: task.executorType === 'internal' ? priced : task.executorType, label: EXECUTOR_SHORT_LABELS[task.executorType === 'internal' ? priced : task.executorType] },
              { value: 'internal', label: EXECUTOR_SHORT_LABELS.internal },
            ]}
            disabled={!staff}
            onChange={(executorType) => executorType !== task.executorType && onPatch(task, { executorType })}
          />
          {!editable && <Lock aria-label="Termos definidos pela P4S" className="size-3.5 text-slate-600" />}
        </div>
      </TableCell>
      <TableCell numeric className={cn('text-xs', overdue ? 'font-semibold text-rose-700' : 'text-slate-900')}>
        {formatDatePt(task.deadline)}
        {overdue && <span className="sr-only"> (em atraso)</span>}
        {afterPhase && (
          <span
            className="block font-sans text-2xs font-medium text-amber-800"
            title={`A ${PHASE_SHORT_LABELS[task.phase]} termina a ${formatDatePt(phaseEndDate(baseDate, task.phase))} (${phaseWindowText(task.phase)}).`}
          >
            depois da {PHASE_SHORT_LABELS[task.phase]}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Select
          aria-label={`Estado de «${task.title}»`}
          className="h-7 text-xs"
          value={task.status}
          onChange={(event) => onPatch(task, { status: event.target.value as Task['status'] })}
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </TableCell>
      <TableCell numeric className={cn('text-sm', counts ? 'text-slate-900' : 'text-slate-600 line-through')}>
        {formatEUR(task.estimatedCost)}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" onClick={() => onOpen(task)} aria-label={`Editar «${task.title}»`}>
          <Pencil aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}
