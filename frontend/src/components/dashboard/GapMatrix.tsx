// Matriz de conformidade por fase: o que falta, quem exige e qual a solução.
// Usa a fotografia gravada no diagnóstico (não recalcula com regras mais recentes).

import { Check, Minus, X } from 'lucide-react';
import type { RequirementSnapshot } from '@engine/models/api.types';
import type { TaskPhase } from '@engine/models/domain';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExecutorBadge } from '@/components/tasks/TaskBadges';
import { PHASE_LABELS, PHASE_WINDOWS, formatEUR } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const PHASES: TaskPhase[] = ['phase_1_urgent', 'phase_2_structural'];

export function GapMatrix({ requirements }: { requirements: RequirementSnapshot[] }) {
  const gaps = requirements.filter((r) => r.status === 'gap').length;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Matriz de conformidade</CardTitle>
          <CardDescription>
            {gaps === 0
              ? 'Sem lacunas no âmbito avaliado.'
              : `${gaps} ${gaps === 1 ? 'lacuna' : 'lacunas'} com remetente identificado, por horizonte de execução.`}
          </CardDescription>
        </div>
      </CardHeader>
      <div className="grid grid-cols-1 divide-y divide-slate-200 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
        {PHASES.map((phase) => {
          const rows = requirements.filter((r) => r.solution.phase === phase);
          return (
            <section key={phase} aria-label={PHASE_LABELS[phase]}>
              <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
                <h3 className="text-xs font-semibold text-slate-900">{PHASE_LABELS[phase]}</h3>
                <span className="font-mono text-2xs tabular-nums text-slate-600">{PHASE_WINDOWS[phase]}</span>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 pb-3 text-xs text-slate-600">Nenhum requisito neste horizonte para o setor avaliado.</p>
              ) : (
                <Table className="min-w-[560px] table-fixed">
                  <colgroup>
                    <col className="w-[27%]" />
                    <col className="w-[21%]" />
                    <col />
                    <col className="w-16" />
                    <col className="w-24" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="border-t-0">
                      <TableHead>Requisito</TableHead>
                      <TableHead>Quem exige</TableHead>
                      <TableHead>Solução</TableHead>
                      <TableHead numeric>Prazo</TableHead>
                      <TableHead numeric>Honorários</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const gap = row.status === 'gap';
                      return (
                        <TableRow key={row.code} className={cn(!gap && 'bg-slate-50/60')}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <StatusIcon status={row.status} />
                              <span className={cn('font-medium', gap ? 'text-slate-900' : 'text-slate-600')}>{row.label}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-700">{row.requiredByLabel}</TableCell>
                          <TableCell>
                            {gap ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-slate-900">{row.solution.title}</span>
                                <ExecutorBadge executor={row.solution.executorType} short />
                              </div>
                            ) : (
                              <span className="text-xs text-slate-600">
                                {row.status === 'compliant' ? 'Conforme' : 'Não aplicável sem refinanciamento'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell numeric className={cn('text-xs', gap ? 'text-slate-900' : 'text-slate-600')}>
                            {gap ? `${row.solution.deadlineDays} d` : '—'}
                          </TableCell>
                          <TableCell numeric className={cn('text-xs', gap ? 'text-slate-900' : 'text-slate-600')}>
                            {gap ? formatEUR(row.solution.estimatedCost) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function StatusIcon({ status }: { status: RequirementSnapshot['status'] }) {
  if (status === 'gap') {
    return (
      <span className="flex size-4 items-center justify-center rounded-sm bg-rose-100 text-rose-700" title="Lacuna">
        <X aria-label="Lacuna" className="size-3" />
      </span>
    );
  }
  if (status === 'compliant') {
    return (
      <span className="flex size-4 items-center justify-center rounded-sm bg-emerald-100 text-emerald-700" title="Conforme">
        <Check aria-label="Conforme" className="size-3" />
      </span>
    );
  }
  return (
    <span className="flex size-4 items-center justify-center rounded-sm bg-slate-100 text-slate-600" title="Não aplicável">
      <Minus aria-label="Não aplicável" className="size-3" />
    </span>
  );
}

export function GapMatrixSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white" aria-busy="true" aria-label="A carregar matriz">
      <div className="border-b border-slate-200 px-4 py-3">
        <Skeleton className="h-3.5 w-44" />
      </div>
      <div className="grid grid-cols-1 gap-6 p-4 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, column) => (
          <div key={column} className="space-y-2.5">
            {Array.from({ length: 3 }, (_, row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="size-4" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
