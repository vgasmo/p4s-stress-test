import { AlertOctagon, Factory, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TaskPhase } from '@engine/models/domain';
import { SPREAD_PENALTY_BPS } from '@engine/services/requirements.catalog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { ExecutorBadge } from '@/components/tasks/TaskBadges';
import type { LocalPreview } from '@/hooks/useAssessment';
import {
  PHASE_SHORT_LABELS,
  formatEUR,
  formatMultiple,
  formatNumberPt,
  formatPerYear,
  formatPercent,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface LiveImpactPreviewProps {
  preview: LocalPreview | { error: string };
  annualRevenue: number;
  creditLineToRefinance: number;
  onUseSampleRevenue: () => void;
  saveArea: ReactNode;
}

const PHASES: TaskPhase[] = ['phase_1_urgent', 'phase_2_structural'];

export function LiveImpactPreview({
  preview,
  annualRevenue,
  creditLineToRefinance,
  onUseSampleRevenue,
  saveArea,
}: LiveImpactPreviewProps) {
  return (
    <Card className="lg:sticky lg:top-16">
      <CardHeader className="items-center">
        <CardTitle>Impacto financeiro em tempo real</CardTitle>
        <Badge tone="outline">Simulação</Badge>
      </CardHeader>
      <PreviewBody
        preview={preview}
        annualRevenue={annualRevenue}
        creditLineToRefinance={creditLineToRefinance}
        onUseSampleRevenue={onUseSampleRevenue}
      />
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">{saveArea}</div>
    </Card>
  );
}

function PreviewBody({
  preview,
  annualRevenue,
  creditLineToRefinance,
  onUseSampleRevenue,
}: Omit<LiveImpactPreviewProps, 'saveArea'>) {
  if ('error' in preview) {
    return (
      <div className="p-4">
        <ErrorBanner title="Os dados introduzidos não permitem calcular." message={preview.error} />
      </div>
    );
  }

  if (annualRevenue <= 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={Factory}
          title="Falta a faturação anual"
          description="Sem faturação não há base exposta. Escreva o valor ou use um dos botões rápidos."
          action={
            <Button size="sm" onClick={onUseSampleRevenue}>
              Usar 5M €
            </Button>
          }
        />
      </div>
    );
  }

  const { result, suggestedTasks } = preview;
  const summary = result.remediationSummary;
  const atRisk = result.commercialRevenueAtRisk;

  return (
    <>
      <div className="space-y-3 px-4 py-4">
        <div>
          <p className="text-xs font-medium text-slate-700">Faturação comercial em risco</p>
          <p
            data-testid="preview-revenue-at-risk"
            aria-live="polite"
            aria-atomic="true"
            className={cn(
              'mt-1 font-mono text-3xl font-bold tabular-nums tracking-tight',
              atRisk > 0 ? 'text-rose-600' : 'text-slate-900',
            )}
          >
            {formatEUR(atRisk)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            <span className="font-mono tabular-nums text-slate-900">{formatPercent(result.commercialRevenueAtRiskShare, 1)}</span>{' '}
            da faturação · base exposta{' '}
            <span className="font-mono tabular-nums text-slate-900">{formatEUR(result.exposedClientRevenue)}</span> nos 3 maiores
            clientes
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-700">Score de exposição</span>
            <span className="font-mono tabular-nums text-slate-900">
              <span className="text-sm font-semibold">{result.riskScore}</span>/100
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className={cn('h-full transition-[width] duration-150', result.riskScore >= 60 ? 'bg-rose-600' : result.riskScore > 0 ? 'bg-amber-500' : 'bg-emerald-600')}
              style={{ width: `${result.riskScore}%` }}
            />
          </div>
        </div>

        {result.dealbreaker && (
          <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
            <AlertOctagon aria-hidden className="mt-0.5 size-4 shrink-0 text-rose-700" />
            <p className="text-xs">
              <span className="font-semibold">
                Bloqueio setorial: peso mínimo de {formatNumberPt(result.dealbreaker.floorPoints / 100, 2)}.
              </span>{' '}
              {result.dealbreaker.reason}
            </p>
          </div>
        )}

        {result.gaps.length === 0 && (
          <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-700" />
            <p className="text-xs">Sem lacunas no âmbito avaliado. A carteira está qualificada para estas exigências.</p>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-3 divide-x divide-slate-200 border-t border-slate-200">
        <Metric label="Penalização bancária" value={formatPerYear(result.estimatedSpreadPenalty)} tone={result.estimatedSpreadPenalty > 0 ? 'amber' : 'plain'}>
          {creditLineToRefinance > 0 ? `${SPREAD_PENALTY_BPS} bps sobre ${formatEUR(creditLineToRefinance)}` : 'Sem refinanciamento'}
        </Metric>
        <Metric label="Bloqueadores críticos" value={String(result.criticalGapCount)} tone={result.criticalGapCount > 0 ? 'rose' : 'plain'}>
          prioridade crítica
        </Metric>
        <Metric label="Investimento" value={formatEUR(summary.totalInvestment)}>
          {summary.totalInvestment > 0 ? `protege ${formatMultiple(summary.protectionRatio)}` : 'nada a contratar'}
        </Metric>
      </dl>

      {suggestedTasks.length > 0 && (
        <div className="border-t border-slate-200">
          <p className="px-4 pb-1 pt-3 text-2xs font-medium uppercase tracking-wide text-slate-600">Plano sugerido</p>
          <ul className="divide-y divide-slate-100">
            {PHASES.flatMap((phase) =>
              suggestedTasks
                .filter((task) => task.phase === phase)
                .map((task) => (
                  <li key={task.requirementCode} className="flex items-center gap-2 px-4 py-1.5">
                    <span className="w-11 shrink-0 font-mono text-2xs tabular-nums text-slate-600">{PHASE_SHORT_LABELS[phase]}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-900" title={task.title}>
                      {task.title}
                    </span>
                    <ExecutorBadge executor={task.executorType} short />
                    <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-slate-900">
                      {formatEUR(task.estimatedCost)}
                    </span>
                  </li>
                )),
            )}
          </ul>
          <dl className="grid grid-cols-3 gap-2 border-t border-slate-200 px-4 py-2 text-xs">
            <BudgetLine label="Fase 1" value={summary.phase1Cost} />
            <BudgetLine label="Fase 2" value={summary.phase2Cost} />
            <BudgetLine label="Total" value={summary.totalInvestment} strong />
          </dl>
        </div>
      )}
    </>
  );
}

function Metric({
  label,
  value,
  tone = 'plain',
  children,
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'rose' | 'amber';
  children: ReactNode;
}) {
  return (
    <div className="px-3 py-3">
      <dt className="text-2xs font-medium uppercase tracking-wide text-slate-600">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-mono text-base font-semibold tabular-nums',
          tone === 'rose' && 'text-rose-700',
          tone === 'amber' && 'text-amber-800',
          tone === 'plain' && 'text-slate-900',
        )}
      >
        {value}
      </dd>
      <dd className="mt-0.5 text-2xs text-slate-600">{children}</dd>
    </div>
  );
}

function BudgetLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-slate-600">{label}</dt>
      <dd className={cn('font-mono tabular-nums', strong ? 'font-semibold text-slate-900' : 'text-slate-900')}>
        {formatEUR(value)}
      </dd>
    </div>
  );
}
