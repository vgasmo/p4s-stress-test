// Painel de impacto do wizard. Dois modos:
//  - com sessão: cálculo completo no browser, com o catálogo que vem da API;
//  - sem sessão: ordens de grandeza por escalões devolvidas pelo servidor, sem pesos nem preços.
// Os valores estimados aparecem como ordem de grandeza («≈ 2,8 M €»): os pesos por trás
// são pressupostos, por isso o número não deve parecer exato ao euro. Os honorários são
// preços e aparecem exatos.

import { AlertOctagon, Factory, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PublicSimulation } from '@engine/models/api.types';
import type { SectorProfile, TaskPhase } from '@engine/models/domain';
import { forSector, REQUIREMENTS, type Catalog } from '@engine/services/requirements';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { ExecutorBadge } from '@/components/tasks/TaskBadges';
import type { LocalPreview } from '@/hooks/useAssessment';
import {
  PHASE_SHORT_LABELS,
  SECTOR_PROFILE_LABELS,
  exactValueTitle,
  formatApproxEUR,
  formatApproxPerYear,
  formatEUR,
  formatEuroRange,
  formatNumberPt,
  formatPercent,
  formatShareOfRisk,
  formatWeight,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';

export type PreviewSource =
  | {
      kind: 'full';
      /** Null enquanto o catálogo não chega. */
      preview: LocalPreview | { error: string } | null;
      catalog: Catalog | undefined;
      loadError: string | null;
      onRetry: () => void;
    }
  | {
      kind: 'public';
      simulation: PublicSimulation | undefined;
      /** Há uma resposta mais recente a caminho: o que está no ecrã é do input anterior. */
      updating: boolean;
      error: string | null;
      onRetry: () => void;
    };

interface LiveImpactPreviewProps {
  source: PreviewSource;
  sectorProfile: SectorProfile;
  annualRevenue: number;
  creditLineToRefinance: number;
  onUseSampleRevenue: () => void;
  saveArea: ReactNode;
}

const PHASES: TaskPhase[] = ['phase_1_urgent', 'phase_2_structural'];
const HEADLINE = 'mt-1 font-mono text-3xl font-bold tabular-nums tracking-tight';

export function LiveImpactPreview({ source, saveArea, ...props }: LiveImpactPreviewProps) {
  return (
    <Card className="lg:sticky lg:top-16">
      <CardHeader className="items-center">
        <CardTitle>Impacto financeiro em tempo real</CardTitle>
        <Badge tone="outline">{source.kind === 'full' ? 'Simulação' : 'Ordem de grandeza'}</Badge>
      </CardHeader>
      {props.annualRevenue <= 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Factory}
            title="Falta a faturação anual"
            description="Sem faturação não há base exposta. Escreva o valor ou use um dos botões rápidos."
            action={
              <Button size="sm" onClick={props.onUseSampleRevenue}>
                Usar 5M €
              </Button>
            }
          />
        </div>
      ) : source.kind === 'full' ? (
        <FullPreview source={source} {...props} />
      ) : (
        <PublicPreview source={source} />
      )}
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">{saveArea}</div>
    </Card>
  );
}

// ── Com sessão ──────────────────────────────────────────────────────────────────────

function FullPreview({
  source,
  sectorProfile,
  creditLineToRefinance,
}: Omit<LiveImpactPreviewProps, 'source' | 'saveArea'> & { source: Extract<PreviewSource, { kind: 'full' }> }) {
  if (source.loadError) {
    return (
      <div className="p-4">
        <ErrorBanner title="Não foi possível carregar os parâmetros do cálculo." message={source.loadError} onRetry={source.onRetry} />
      </div>
    );
  }
  if (!source.preview || !source.catalog) return <PreviewSkeleton />;
  if ('error' in source.preview) {
    return (
      <div className="p-4">
        <ErrorBanner title="Os dados introduzidos não permitem calcular." message={source.preview.error} />
      </div>
    );
  }

  const { result, suggestedTasks } = source.preview;
  const { catalog } = source;
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
            title={exactValueTitle(atRisk)}
            className={cn(HEADLINE, atRisk > 0 ? 'text-rose-600' : 'text-slate-900')}
          >
            {formatApproxEUR(atRisk)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            <span className="font-mono tabular-nums text-slate-900">
              {formatPercent(Math.round(result.commercialRevenueAtRiskShare))}
            </span>{' '}
            da faturação · base exposta{' '}
            <span className="font-mono tabular-nums text-slate-900">{formatEUR(result.exposedClientRevenue)}</span> nos 3 maiores
            clientes
          </p>
        </div>

        <ScoreBar score={result.riskScore} />

        {result.dealbreaker && (
          <Blocker>
            <span className="font-semibold">
              Bloqueio setorial: peso mínimo de {formatNumberPt(result.dealbreaker.floorPoints / 100, 2)}.
            </span>{' '}
            {result.dealbreaker.reason}
          </Blocker>
        )}

        {result.gaps.length === 0 && <AllClear />}

        <details className="group rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-700">
          <summary className="cursor-pointer select-none rounded-md px-3 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
            Ordem de grandeza: ver pressupostos
          </summary>
          <div className="space-y-1.5 border-t border-slate-200 px-3 py-2">
            <p>
              Os pesos e o agravamento de spread são pressupostos de trabalho da Plan4Sustain para{' '}
              {SECTOR_PROFILE_LABELS[sectorProfile].toLowerCase()}, não medições desta fábrica.
            </p>
            <ul className="space-y-0.5">
              {REQUIREMENTS.filter((requirement) => requirement.channel === 'commercial').map((requirement) => {
                const parameters = catalog.parameters[requirement.code];
                return (
                  <li key={requirement.code} className="flex justify-between gap-3">
                    <span>
                      Sem {requirement.label}
                      {parameters.evidence ? ` (${parameters.evidence})` : ''}
                    </span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {formatWeight(forSector(parameters.weightPoints, sectorProfile))}
                    </span>
                  </li>
                );
              })}
              <li className="flex justify-between gap-3">
                <span>Agravamento de spread sem rácios ESG</span>
                <span className="font-mono tabular-nums text-slate-900">{catalog.spreadPenaltyBps} bps/ano</span>
              </li>
            </ul>
          </div>
        </details>
      </div>

      <dl className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] divide-x divide-slate-200 border-t border-slate-200">
        <Metric
          label="Penalização bancária"
          value={formatApproxPerYear(result.estimatedSpreadPenalty)}
          title={exactValueTitle(result.estimatedSpreadPenalty, '/ano')}
          tone={result.estimatedSpreadPenalty > 0 ? 'amber' : 'plain'}
          size="sm"
        >
          {creditLineToRefinance > 0
            ? `${catalog.spreadPenaltyBps} bps sobre ${formatEUR(creditLineToRefinance)}`
            : 'Sem refinanciamento'}
        </Metric>
        <Metric label="Bloqueadores críticos" value={String(result.criticalGapCount)} tone={result.criticalGapCount > 0 ? 'rose' : 'plain'}>
          prioridade crítica
        </Metric>
        <Metric label="Investimento" value={formatEUR(summary.totalInvestment)}>
          {summary.totalInvestment === 0
            ? 'nada a contratar'
            : summary.totalCostShareOfRisk !== null
              ? `${formatShareOfRisk(summary.totalCostShareOfRisk)} da faturação em risco`
              : 'honorários fixos'}
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

// ── Sem sessão ──────────────────────────────────────────────────────────────────────

function PublicPreview({ source }: { source: Extract<PreviewSource, { kind: 'public' }> }) {
  if (source.error && !source.simulation) {
    return (
      <div className="p-4">
        <ErrorBanner title="Não foi possível calcular." message={source.error} onRetry={source.onRetry} />
      </div>
    );
  }
  if (!source.simulation) return <PreviewSkeleton />;

  const { commercialRisk, spreadPenalty, sectorBlocker, gaps, gapCount, criticalGapCount, exposedClientRevenue } =
    source.simulation;

  return (
    <div aria-busy={source.updating} className={cn('transition-opacity', source.updating && 'opacity-60')}>
      <div className="space-y-3 px-4 py-4">
        {source.error && <ErrorBanner title="Não foi possível atualizar." message={source.error} onRetry={source.onRetry} />}
        <div>
          <p className="text-xs font-medium text-slate-700">Faturação comercial em risco</p>
          <p
            data-testid="preview-revenue-at-risk"
            aria-live="polite"
            aria-atomic="true"
            className={cn(HEADLINE, commercialRisk ? 'text-rose-600' : 'text-slate-900')}
          >
            {commercialRisk ? formatEuroRange(commercialRisk.low, commercialRisk.high) : formatEUR(0)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {commercialRisk && (
              <>
                <span className="font-mono tabular-nums text-slate-900">
                  {commercialRisk.lowShare}–{commercialRisk.highShare}%
                </span>{' '}
                da faturação nos 3 maiores clientes ·{' '}
              </>
            )}
            base exposta <span className="font-mono tabular-nums text-slate-900">{formatEUR(exposedClientRevenue)}</span>
          </p>
        </div>

        {sectorBlocker && (
          <Blocker>
            <span className="font-semibold">Bloqueio setorial.</span> {sectorBlocker}
          </Blocker>
        )}
        {gapCount === 0 && <AllClear />}
      </div>

      <dl className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] divide-x divide-slate-200 border-t border-slate-200">
        <Metric
          label="Penalização bancária"
          value={spreadPenalty ? `${formatEuroRange(spreadPenalty.low, spreadPenalty.high)}/ano` : `${formatEUR(0)}/ano`}
          tone={spreadPenalty ? 'amber' : 'plain'}
          size="xs"
        >
          {spreadPenalty ? 'agravamento de spread' : 'sem agravamento'}
        </Metric>
        <Metric label="Lacunas" value={String(gapCount)} tone={criticalGapCount > 0 ? 'rose' : 'plain'}>
          {criticalGapCount} {criticalGapCount === 1 ? 'crítica' : 'críticas'}
        </Metric>
        <Metric label="Investimento" value="Preço fechado" size="xs">
          na proposta
        </Metric>
      </dl>

      {gaps.length > 0 && (
        <div className="border-t border-slate-200">
          <p className="px-4 pb-1 pt-3 text-2xs font-medium uppercase tracking-wide text-slate-600">O que falta</p>
          <ul className="divide-y divide-slate-100">
            {PHASES.flatMap((phase) =>
              gaps
                .filter((gap) => gap.phase === phase)
                .map((gap) => (
                  <li key={gap.code} className="flex items-center gap-2 px-4 py-1.5">
                    <span className="w-11 shrink-0 font-mono text-2xs tabular-nums text-slate-600">{PHASE_SHORT_LABELS[phase]}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-900" title={`${gap.solutionTitle} (exigido por ${gap.requiredByLabel})`}>
                      {gap.solutionTitle}
                    </span>
                    {gap.critical && <Badge tone="critical">Crítica</Badge>}
                    <ExecutorBadge executor={gap.executorType} short />
                  </li>
                )),
            )}
          </ul>
        </div>
      )}

      <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
        Ordem de grandeza. O valor estimado, o plano e o preço fechado ficam no diagnóstico completo, com a equipa
        Plan4Sustain.
      </p>
    </div>
  );
}

// ── Partes comuns ───────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-700">Score de exposição</span>
        <span className="font-mono tabular-nums text-slate-900">
          <span className="text-sm font-semibold">{score}</span>/100
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn('h-full transition-[width] duration-150', score >= 60 ? 'bg-rose-600' : score > 0 ? 'bg-amber-500' : 'bg-emerald-600')}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function Blocker({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
      <AlertOctagon aria-hidden className="mt-0.5 size-4 shrink-0 text-rose-700" />
      <p className="text-xs">{children}</p>
    </div>
  );
}

function AllClear() {
  return (
    <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-700" />
      <p className="text-xs">Sem lacunas no âmbito avaliado. A carteira está qualificada para estas exigências.</p>
    </div>
  );
}

function Metric({
  label,
  value,
  title,
  tone = 'plain',
  size = 'base',
  children,
}: {
  label: string;
  value: string;
  title?: string;
  tone?: 'plain' | 'rose' | 'amber';
  /** Valores compridos (com «/ano», escalões, texto) usam corpo mais pequeno para caberem na coluna. */
  size?: 'base' | 'sm' | 'xs';
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 px-3 py-3">
      <dt className="text-2xs font-medium uppercase tracking-wide text-slate-600">{label}</dt>
      <dd
        title={title}
        className={cn(
          'mt-1 font-mono font-semibold tabular-nums',
          size === 'base' && 'text-base',
          size === 'sm' && 'text-sm leading-6',
          size === 'xs' && 'text-xs leading-5',
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
      <dd className={cn('font-mono tabular-nums text-slate-900', strong && 'font-semibold')}>{formatEUR(value)}</dd>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="A calcular">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-3 w-64" />
      <Skeleton className="h-1.5 w-full" />
      <div className="grid grid-cols-3 gap-3 pt-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </div>
  );
}
