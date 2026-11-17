// Barra de comparação executiva: o que está em risco vs. quanto custa resolver.
// Os totais são recalculados a partir das tarefas atuais (configurador de proposta),
// com a mesma função que a API usa.

import type { ReactNode } from 'react';
import type { AssessmentDetail } from '@engine/models/api.types';
import type { Task } from '@engine/models/domain';
import { SPREAD_PENALTY_BPS } from '@engine/services/requirements.catalog';
import { countsTowardsProposal, summarizeRemediation } from '@engine/services/remediation-summary';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatEUR,
  formatMultiple,
  formatNumberPt,
  formatPerYear,
  formatPercent,
  formatShareOfRisk,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface ExecutiveScoreboardProps {
  assessment: AssessmentDetail;
  tasks: Task[];
}

// As células ficam separadas por 1 px do fundo da grelha, com qualquer número de colunas.
const GRID = 'grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid-cols-2 xl:grid-cols-4';

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function ExecutiveScoreboard({ assessment, tasks }: ExecutiveScoreboardProps) {
  const summary = summarizeRemediation(tasks, assessment.commercialRevenueAtRisk, assessment.estimatedSpreadPenalty);
  const phase1Count = tasks.filter((task) => countsTowardsProposal(task) && task.phase === 'phase_1_urgent').length;
  const openCritical = tasks.filter((task) => task.priority === 'critical' && task.status !== 'completed').length;
  const { snapshot } = assessment;
  const spread = assessment.estimatedSpreadPenalty;

  return (
    <section aria-label="Comparação executiva" className={GRID}>
      <Cell
        label="Carteira comercial exposta"
        value={formatEUR(assessment.commercialRevenueAtRisk)}
        valueClass={assessment.commercialRevenueAtRisk > 0 ? 'text-rose-700' : 'text-slate-900'}
        testId="kpi-commercial-risk"
        badge={
          snapshot.dealbreaker ? (
            <Badge tone="critical">Piso setorial {formatNumberPt(snapshot.dealbreaker.floorPoints / 100, 2)}</Badge>
          ) : null
        }
      >
        <Num>{formatPercent(snapshot.commercialRevenueAtRiskShare, 1)}</Num> da faturação · score{' '}
        <Num>{assessment.riskScore}</Num>/100
      </Cell>

      <Cell
        label="Penalização bancária anual"
        value={formatPerYear(spread)}
        valueClass={spread > 0 ? 'text-amber-800' : 'text-slate-900'}
        testId="kpi-spread"
      >
        {assessment.creditLineToRefinance > 0 ? (
          spread > 0 ? (
            <>
              {SPREAD_PENALTY_BPS} bps sobre <Num>{formatEUR(assessment.creditLineToRefinance)}</Num> a refinanciar
            </>
          ) : (
            'Rácios ESG disponíveis para o refinanciamento'
          )
        ) : (
          'Sem refinanciamento nos próximos 18 meses'
        )}
      </Cell>

      <Cell
        label="Investimento Fase 1 (chave-na-mão)"
        value={formatEUR(summary.phase1Cost)}
        testId="kpi-phase1"
        badge={
          summary.phase1CostShareOfRisk !== null && summary.phase1Cost > 0 ? (
            <Badge tone="p4s">Custo equivale a {formatShareOfRisk(summary.phase1CostShareOfRisk)} da faturação em risco</Badge>
          ) : null
        }
      >
        <Num>{phase1Count}</Num> {plural(phase1Count, 'entregável', 'entregáveis')} · <Num>{openCritical}</Num>{' '}
        {plural(openCritical, 'lacuna crítica', 'lacunas críticas')} em aberto
      </Cell>

      <Cell label="Investimento total" value={formatEUR(summary.totalInvestment)} testId="kpi-total">
        Fase 2 <Num>{formatEUR(summary.phase2Cost)}</Num>
        {summary.totalInvestment > 0 && (
          <>
            {' '}
            · protege <Num>{formatMultiple(summary.protectionRatio)}</Num> o investimento
          </>
        )}
      </Cell>
    </section>
  );
}

function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono tabular-nums text-slate-900">{children}</span>;
}

function Cell({
  label,
  value,
  valueClass,
  badge,
  testId,
  children,
}: {
  label: string;
  value: string;
  valueClass?: string;
  badge?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p data-testid={testId} className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight', valueClass ?? 'text-slate-900')}>
        {value}
      </p>
      {badge && <div className="mt-1">{badge}</div>}
      <p className="mt-1 text-xs text-slate-600">{children}</p>
    </div>
  );
}

export function ExecutiveScoreboardSkeleton() {
  return (
    <div className={GRID} aria-busy="true" aria-label="A carregar indicadores">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-2 bg-white px-4 py-3">
          <Skeleton className="h-2.5 w-36" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3 w-48" />
        </div>
      ))}
    </div>
  );
}
