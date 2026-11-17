// Matriz de conformidade por fase: o que faltava no diagnóstico, quem o exige e o que o
// plano responde hoje a cada lacuna.
//
// As lacunas e os pesos vêm da fotografia do diagnóstico (não se recalcula com regras mais
// recentes). A resposta vem das tarefas atuais: se o consultor renegociou honorários, passou
// o entregável a interno, o tirou da proposta ou o eliminou, a matriz diz o mesmo que o
// configurador. No fim mostra as contas e os pressupostos por trás de cada número.
//
// Em ecrãs estreitos a tabela dá lugar a uma lista: prazo e honorários ficam à vista sem
// deslizar para o lado.

import { Check, Minus, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AssessmentDetail, RequirementSnapshot } from '@engine/models/api.types';
import type { Task, TaskPhase } from '@engine/models/domain';
import { gapLines, type GapLine } from '@engine/services/plan-coverage';
import { REQUIREMENTS } from '@engine/services/requirements';
import { ExecutorBadge } from '@/components/tasks/TaskBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRestoreDeliverable } from '@/hooks/usePlan';
import { errorMessage } from '@/lib/api';
import {
  formatBasisPoints,
  formatDatePt,
  formatEUR,
  formatNumberPt,
  formatPercent,
  formatWeight,
  phaseLabel,
  phaseWindowText,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';

const PHASES: TaskPhase[] = ['phase_1_urgent', 'phase_2_structural'];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

interface GapMatrixProps {
  assessment: AssessmentDetail;
  /** Tarefas atuais do plano. */
  tasks: Task[];
  staff: boolean;
}

export function GapMatrix({ assessment, tasks, staff }: GapMatrixProps) {
  const { requirements } = assessment.snapshot;
  const lines = gapLines(assessment.snapshot, tasks);
  const lineByCode = new Map(lines.map((line) => [line.requirement.code, line]));
  const resolved = lines.filter((line) => line.resolved).length;
  const restore = useRestoreDeliverable(assessment.id);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Matriz de conformidade</CardTitle>
          <CardDescription>
            {lines.length === 0
              ? 'Sem lacunas no âmbito avaliado.'
              : `${plural(lines.length, 'lacuna', 'lacunas')} no diagnóstico de ${formatDatePt(assessment.snapshot.baseDate)}${
                  resolved > 0 ? `, ${plural(resolved, 'já resolvida', 'já resolvidas')}` : ''
                }. A resposta de cada uma acompanha o plano em baixo.`}
          </CardDescription>
        </div>
      </CardHeader>
      {restore.isError && (
        <p role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-900">
          O entregável não foi reposto. {errorMessage(restore.error)}
        </p>
      )}
      <div className="grid grid-cols-1 divide-y divide-slate-200 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
        {PHASES.map((phase) => {
          // Uma lacuna aparece na fase do entregável que hoje lhe responde.
          const rows = requirements.filter(
            (requirement) => (lineByCode.get(requirement.code)?.phase ?? requirement.solution.phase) === phase,
          );
          return (
            <section key={phase} aria-label={phaseLabel(phase)}>
              <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
                <h3 className="text-xs font-semibold text-slate-900">{phaseLabel(phase)}</h3>
                <span className="font-mono text-2xs tabular-nums text-slate-600">{phaseWindowText(phase)}</span>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 pb-3 text-xs text-slate-600">Nenhum requisito neste horizonte.</p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-200 border-t border-slate-200 sm:hidden">
                    {rows.map((row) => (
                      <GapCard
                        key={row.code}
                        row={row}
                        line={lineByCode.get(row.code)}
                        staff={staff}
                        restoring={restore.isPending && restore.variables === row.code}
                        onRestore={() => restore.mutate(row.code)}
                      />
                    ))}
                  </ul>
                  <div className="hidden sm:block">
                    <Table className="min-w-[560px] table-fixed">
                      <colgroup>
                        <col className="w-[27%]" />
                        <col className="w-[19%]" />
                        <col />
                        <col className="w-20" />
                        <col className="w-24" />
                      </colgroup>
                      <TableHeader>
                        <TableRow className="border-t-0">
                          <TableHead>Requisito</TableHead>
                          <TableHead>Quem exige</TableHead>
                          <TableHead>Resposta no plano</TableHead>
                          <TableHead numeric>Prazo</TableHead>
                          <TableHead numeric>Honorários</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => {
                          const line = lineByCode.get(row.code);
                          const open = line !== undefined && !line.resolved;
                          return (
                            <TableRow key={row.code} className={cn(!open && 'bg-slate-50/60')} data-testid={`gap-${row.code}`}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <StatusIcon status={row.status} resolved={line?.resolved ?? false} />
                                  <span className={cn('font-medium', open ? 'text-slate-900' : 'text-slate-600')}>{row.label}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-slate-700">{row.requiredByLabel}</TableCell>
                              {line ? (
                                <GapAnswer
                                  line={line}
                                  staff={staff}
                                  restoring={restore.isPending && restore.variables === row.code}
                                  onRestore={() => restore.mutate(row.code)}
                                />
                              ) : (
                                <>
                                  <TableCell>
                                    <span className="text-xs text-slate-600">{noGapText(row)}</span>
                                  </TableCell>
                                  <TableCell numeric className="text-xs text-slate-600">
                                    —
                                  </TableCell>
                                  <TableCell numeric className="text-xs text-slate-600">
                                    —
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>
      <RequirementGlossary requirements={requirements} />
      <Assumptions assessment={assessment} />
    </Card>
  );
}

const noGapText = (row: RequirementSnapshot) => (row.status === 'compliant' ? 'Conforme' : 'Não aplicável sem refinanciamento');

interface GapAnswerProps {
  line: GapLine;
  staff: boolean;
  restoring: boolean;
  onRestore: () => void;
}

/** O que o plano responde a uma lacuna: o entregável e quem o faz, ou a falta dele. */
function AnswerSummary({ line, staff, restoring, onRestore }: GapAnswerProps) {
  const { task, coverage, resolved } = line;
  if (!task) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-amber-800">Sem entregável no plano</span>
        {staff && (
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onRestore} disabled={restoring}>
            <RotateCcw aria-hidden /> {restoring ? 'A repor…' : 'Repor'}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn('text-xs', coverage === 'excluded' ? 'text-slate-600' : 'text-slate-900')}>{task.title}</span>
      {coverage === 'excluded' ? <Badge tone="outline">Fora da proposta</Badge> : <ExecutorBadge executor={task.executorType} short />}
      {resolved && <Badge tone="success">Concluído</Badge>}
    </div>
  );
}

/** Prazo e honorários de uma lacuna, como o configurador os tem agora (null: não se aplica). */
function answerTerms(line: GapLine): { deadline: string | null; fees: string | null; feesHint: string | undefined } {
  const { task, coverage } = line;
  return {
    deadline: task && coverage !== 'excluded' ? formatDatePt(task.deadline) : null,
    fees: task && coverage === 'proposal' ? formatEUR(task.estimatedCost) : null,
    feesHint: task && coverage === 'internal' ? 'A cargo da empresa: não entra na proposta' : undefined,
  };
}

/** Uma linha da matriz em ecrã estreito: requisito, quem exige e a resposta, uns por baixo dos outros. */
function GapCard({
  row,
  line,
  staff,
  restoring,
  onRestore,
}: Omit<GapAnswerProps, 'line'> & { row: RequirementSnapshot; line: GapLine | undefined }) {
  const open = line !== undefined && !line.resolved;
  const terms = line ? answerTerms(line) : null;
  return (
    <li className={cn('flex gap-2 px-4 py-2.5', !open && 'bg-slate-50/60')} data-testid={`gap-card-${row.code}`}>
      <span className="mt-0.5 shrink-0">
        <StatusIcon status={row.status} resolved={line?.resolved ?? false} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn('text-sm font-medium', open ? 'text-slate-900' : 'text-slate-600')}>{row.label}</p>
        <p className="text-xs text-slate-600">Exigido por {row.requiredByLabel}</p>
        {line ? (
          <AnswerSummary line={line} staff={staff} restoring={restoring} onRestore={onRestore} />
        ) : (
          <p className="text-xs text-slate-600">{noGapText(row)}</p>
        )}
        {terms && (terms.deadline !== null || terms.fees !== null || terms.feesHint) && (
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
            {terms.deadline !== null && (
              <div>
                <dt className="inline">Prazo </dt>
                <dd className="inline font-mono tabular-nums text-slate-900">{terms.deadline}</dd>
              </div>
            )}
            {terms.fees !== null ? (
              <div>
                <dt className="inline">Honorários </dt>
                <dd className="inline font-mono tabular-nums text-slate-900">{terms.fees}</dd>
              </div>
            ) : (
              terms.feesHint && <div>{terms.feesHint}</div>
            )}
          </dl>
        )}
      </div>
    </li>
  );
}

/** As três últimas colunas de uma lacuna: o que o plano lhe responde hoje, quando e por quanto. */
function GapAnswer(props: GapAnswerProps) {
  const { coverage } = props.line;
  const terms = answerTerms(props.line);
  const muted = coverage === 'excluded' || coverage === 'removed';
  return (
    <>
      <TableCell>
        <AnswerSummary {...props} />
      </TableCell>
      <TableCell numeric className={cn('text-xs', muted ? 'text-slate-600' : 'text-slate-900')}>
        {terms.deadline ?? '—'}
      </TableCell>
      <TableCell numeric className={cn('text-xs', terms.fees !== null ? 'text-slate-900' : 'text-slate-600')} title={terms.feesHint}>
        {terms.fees ?? '—'}
      </TableCell>
    </>
  );
}

const DISCLOSURE_SUMMARY =
  'cursor-pointer select-none px-4 py-2.5 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900';

/** O que é cada requisito, em linguagem de fábrica: quem lê o plano pode não ser quem esteve na reunião. */
function RequirementGlossary({ requirements }: { requirements: RequirementSnapshot[] }) {
  const entries = requirements.flatMap((requirement) => {
    const definition = REQUIREMENTS.find((candidate) => candidate.code === requirement.code);
    return definition ? [{ code: requirement.code, label: requirement.label, summary: definition.summary }] : [];
  });
  if (entries.length === 0) return null;

  return (
    <details className="group border-t border-slate-200 text-xs text-slate-700" data-testid="requirement-glossary">
      <summary className={DISCLOSURE_SUMMARY}>O que é cada requisito e o que conta como «já tem»</summary>
      <dl className="max-w-3xl space-y-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
        {entries.map((entry) => (
          <div key={entry.code}>
            <dt className="font-medium text-slate-900">{entry.label}</dt>
            <dd className="max-w-prose">{entry.summary}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** As contas por trás dos números, com o que é pressuposto dito às claras. */
function Assumptions({ assessment }: { assessment: AssessmentDetail }) {
  const { snapshot } = assessment;
  const { input } = snapshot;
  const commercialGaps = snapshot.requirements.filter((r) => r.status === 'gap' && r.channel === 'commercial');
  const weightUsed = assessment.riskScore;
  const floor = snapshot.dealbreaker?.raisedWeight ? snapshot.dealbreaker.floorPoints : null;
  const hasSpread = assessment.estimatedSpreadPenalty > 0;

  return (
    <details className="group border-t border-slate-200 text-xs text-slate-700">
      <summary className={DISCLOSURE_SUMMARY}>De onde vêm os números e que pressupostos têm</summary>
      <div className="space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
        <p className="max-w-prose">
          Os valores em euros da carteira exposta e da penalização bancária são ordens de grandeza. O peso de cada lacuna e
          o agravamento de spread são pressupostos de trabalho da Plan4Sustain para o setor, não medições desta empresa.
          São os do dia do diagnóstico: não mudam quando um entregável é concluído.
        </p>
        <dl className="grid max-w-3xl grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Line label={`Base exposta: ${formatPercent(input.topClientsShare)} de ${formatEUR(input.annualRevenue)} nos 3 maiores clientes`}>
            {formatEUR(snapshot.exposedClientRevenue)}
          </Line>
          {commercialGaps.map((gap) => (
            <Line key={gap.code} label={`Sem ${gap.label}${gap.evidence ? ` (${gap.evidence})` : ''}`}>
              {formatWeight(gap.weightPoints)}
            </Line>
          ))}
          {commercialGaps.length > 0 && (
            <Line
              label={
                floor !== null
                  ? `Peso usado: mínimo do bloqueio setorial (a soma das lacunas dava ${formatNumberPt(snapshot.commercialGapPoints / 100, 2)})`
                  : snapshot.commercialGapPoints > 100
                    ? `Peso usado: limitado a 1,00 (a soma das lacunas dava ${formatNumberPt(snapshot.commercialGapPoints / 100, 2)})`
                    : 'Peso usado: soma das lacunas'
              }
            >
              {formatNumberPt(weightUsed / 100, 2)}
            </Line>
          )}
          <Line label="Faturação comercial em risco: base exposta × peso usado" strong>
            {formatEUR(assessment.commercialRevenueAtRisk)}
          </Line>
          {hasSpread && (
            <Line
              label={`Penalização bancária: ${formatEUR(assessment.creditLineToRefinance)} a refinanciar${
                snapshot.spreadPenaltyBps
                  ? ` × ${formatBasisPoints(snapshot.spreadPenaltyBps)} ao ano (${snapshot.spreadPenaltyBps} pontos base)`
                  : ''
              }`}
              strong
            >
              {formatEUR(assessment.estimatedSpreadPenalty)}/ano
            </Line>
          )}
        </dl>
      </div>
    </details>
  );
}

function Line({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className={cn(strong && 'font-medium text-slate-900')}>{label}</dt>
      <dd className={cn('font-mono tabular-nums text-slate-900 sm:text-right', strong && 'font-semibold')}>{children}</dd>
    </>
  );
}

function StatusIcon({ status, resolved }: { status: RequirementSnapshot['status']; resolved: boolean }) {
  if (status === 'gap' && !resolved) {
    return (
      <span className="flex size-4 items-center justify-center rounded-sm bg-rose-100 text-rose-700" title="Lacuna">
        <X aria-label="Lacuna" className="size-3" />
      </span>
    );
  }
  if (status === 'gap' || status === 'compliant') {
    const label = status === 'gap' ? 'Lacuna resolvida' : 'Conforme';
    return (
      <span className="flex size-4 items-center justify-center rounded-sm bg-emerald-100 text-emerald-700" title={label}>
        <Check aria-label={label} className="size-3" />
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
