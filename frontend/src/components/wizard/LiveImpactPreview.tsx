// Painel de impacto do wizard. Dois modos:
//  - com sessão: cálculo completo no browser, com o catálogo que vem da API;
//  - sem sessão: ordens de grandeza por escalões devolvidas pelo servidor, sem pesos nem preços.
// Os valores estimados aparecem como ordem de grandeza («≈ 2,8 M €»): os pesos por trás
// são pressupostos, por isso o número não deve parecer exato ao euro. Os honorários são
// preços e aparecem exatos.
//
// O número em risco fica num bloco preso, para estar à vista enquanto se responde:
//  - em ecrãs largos o painel fica ao lado do formulário e o bloco prende-se no topo dele,
//    por cima do resto do painel quando este é mais alto do que a janela;
//  - em ecrãs estreitos o painel vai para o fim do formulário e só o bloco sobe para o topo,
//    preso logo abaixo do cabeçalho da aplicação (--pin-top, dado pelo wizard).

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
  formatBasisPoints,
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
  /** O refinanciamento está ligado, mas o montante ainda não foi indicado. */
  creditAmountMissing: boolean;
  onUseSampleRevenue: () => void;
  saveArea: ReactNode;
  /** Recebe o bloco preso, para o wizard lhe medir a altura e não deixar o foco ficar por baixo. */
  pinnedRef?: (element: HTMLDivElement | null) => void;
}

/** O que o bloco preso mostra: o número em risco, ou a razão de ainda não haver número. */
type Headline =
  | {
      kind: 'value';
      text: string;
      /** Valor calculado ao euro, para quem quer ver o número por trás da ordem de grandeza. */
      title?: string;
      alarming: boolean;
      detail: ReactNode;
      score?: number;
      /** Há um resultado mais recente a caminho. */
      stale?: boolean;
    }
  | { kind: 'loading' }
  | { kind: 'missing'; reason: string };

interface PreviewParts {
  headline: Headline;
  body: ReactNode;
}

const PHASES: TaskPhase[] = ['phase_1_urgent', 'phase_2_structural'];
const HEADLINE = 'mt-1 font-mono text-3xl font-bold tabular-nums tracking-tight';
const FIGURE = 'font-mono tabular-nums text-slate-900';
/** Em janelas muito baixas (telemóvel deitado) o bloco preso fica só com o número. */
const HIDDEN_WHEN_SHORT = 'max-lg:[@media(max-height:480px)]:hidden';

export function LiveImpactPreview({ source, saveArea, pinnedRef, ...props }: LiveImpactPreviewProps) {
  const { headline, body } =
    props.annualRevenue <= 0
      ? missingRevenue(props.onUseSampleRevenue)
      : source.kind === 'full'
        ? fullPreview(source, props)
        : publicPreview(source, props.creditAmountMissing);
  const title = (
    <>
      <CardTitle>Impacto financeiro em tempo real</CardTitle>
      <Badge tone="outline">{source.kind === 'full' ? 'Simulação' : 'Ordem de grandeza'}</Badge>
    </>
  );

  return (
    <Card className="max-lg:contents lg:sticky lg:top-[var(--pin-top,4rem)]">
      <div
        ref={pinnedRef}
        className={cn(
          // Preso logo abaixo do cabeçalho, com a linha de cima por baixo da linha dele.
          'sticky top-[calc(var(--pin-top,3rem)-1px)] z-20 order-first rounded-lg border border-slate-200 bg-white shadow-[0_10px_15px_-12px_rgb(15_23_42/0.5)]',
          // Dentro do painel: desenha o topo do cartão e tapa o que passa entre ele e o cabeçalho.
          'lg:top-[var(--pin-top,4rem)] lg:z-10 lg:order-none lg:-mx-px lg:-mt-px lg:rounded-b-none lg:shadow-none',
          "lg:before:pointer-events-none lg:before:absolute lg:before:-inset-x-px lg:before:bottom-[calc(100%+1px)] lg:before:h-4 lg:before:bg-slate-50 lg:before:content-['']",
        )}
      >
        <CardHeader className={cn('hidden items-center lg:flex', headline.kind === 'missing' && 'lg:border-b-0')}>{title}</CardHeader>
        <PinnedHeadline headline={headline} />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white lg:rounded-none lg:border-0 lg:bg-transparent lg:[--focus-top:calc(var(--pin-top,4rem)_+_var(--pin-height,0px)_+_0.75rem)]">
        <CardHeader className="items-center lg:hidden">{title}</CardHeader>
        {body}
        <div className="rounded-b-lg border-t border-slate-200 bg-slate-50 px-4 py-3">{saveArea}</div>
      </div>
    </Card>
  );
}

function PinnedHeadline({ headline }: { headline: Headline }) {
  const stale = headline.kind === 'value' && headline.stale === true;
  const score = headline.kind === 'value' ? headline.score : undefined;
  return (
    <div
      aria-busy={stale || headline.kind === 'loading'}
      className={cn(
        'grid gap-x-6 gap-y-2 px-4 py-3 transition-opacity lg:gap-y-3 lg:py-4',
        score !== undefined && 'sm:max-lg:grid-cols-[minmax(0,1fr)_16rem] sm:max-lg:items-end',
        stale && 'opacity-60',
        // Sem número, em ecrãs largos basta o aviso que o painel mostra logo abaixo.
        headline.kind === 'missing' && 'lg:hidden',
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-700">Faturação comercial em risco</p>
        {headline.kind === 'value' ? (
          <p
            data-testid="preview-revenue-at-risk"
            aria-live="polite"
            aria-atomic="true"
            title={headline.title}
            className={cn(HEADLINE, headline.alarming ? 'text-rose-600' : 'text-slate-900')}
          >
            {headline.text}
          </p>
        ) : headline.kind === 'loading' ? (
          <Skeleton className="mt-1 h-9 w-56 max-w-full" />
        ) : (
          <p aria-hidden className={cn(HEADLINE, 'text-slate-400')}>
            —
          </p>
        )}
        {headline.kind === 'loading' ? (
          <Skeleton className={cn('mt-2 h-3 w-64 max-w-full', HIDDEN_WHEN_SHORT)} />
        ) : (
          <p className={cn('mt-1 text-xs text-slate-600', HIDDEN_WHEN_SHORT)}>
            {headline.kind === 'value' ? headline.detail : headline.reason}
          </p>
        )}
      </div>
      {score !== undefined && <ScoreBar score={score} className={HIDDEN_WHEN_SHORT} />}
    </div>
  );
}

const padded = (children: ReactNode) => <div className="p-4">{children}</div>;

function missingRevenue(onUseSampleRevenue: () => void): PreviewParts {
  return {
    headline: { kind: 'missing', reason: 'Falta a faturação anual.' },
    body: padded(
      <EmptyState
        icon={Factory}
        title="Falta a faturação anual"
        description="Sem faturação não há base exposta. Escreva o valor ou use um dos botões rápidos."
        action={
          <Button size="sm" onClick={onUseSampleRevenue}>
            Usar 5M €
          </Button>
        }
      />,
    ),
  };
}

// ── Com sessão ──────────────────────────────────────────────────────────────────────

function fullPreview(
  source: Extract<PreviewSource, { kind: 'full' }>,
  {
    sectorProfile,
    creditLineToRefinance,
    creditAmountMissing,
  }: Pick<LiveImpactPreviewProps, 'sectorProfile' | 'creditLineToRefinance' | 'creditAmountMissing'>,
): PreviewParts {
  if (source.loadError) {
    return {
      headline: { kind: 'missing', reason: 'Cálculo indisponível.' },
      body: padded(
        <ErrorBanner title="Não foi possível carregar os parâmetros do cálculo." message={source.loadError} onRetry={source.onRetry} />,
      ),
    };
  }
  if (!source.preview || !source.catalog) return { headline: { kind: 'loading' }, body: <PreviewSkeleton /> };
  if ('error' in source.preview) {
    return {
      headline: { kind: 'missing', reason: 'Cálculo indisponível.' },
      body: padded(<ErrorBanner title="Os dados introduzidos não permitem calcular." message={source.preview.error} />),
    };
  }

  const { result, suggestedTasks } = source.preview;
  const { catalog } = source;
  const summary = result.remediationSummary;
  const atRisk = result.commercialRevenueAtRisk;

  return {
    headline: {
      kind: 'value',
      text: formatApproxEUR(atRisk),
      title: exactValueTitle(atRisk),
      alarming: atRisk > 0,
      score: result.riskScore,
      detail: (
        <>
          <span className={FIGURE}>{formatPercent(Math.round(result.commercialRevenueAtRiskShare))}</span> da faturação · base
          exposta <span className={FIGURE}>{formatEUR(result.exposedClientRevenue)}</span> nos 3 maiores clientes
        </>
      ),
    },
    body: (
      <>
        <div className="space-y-3 px-4 py-4">
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
                      <span className={FIGURE}>{formatWeight(forSector(parameters.weightPoints, sectorProfile))}</span>
                    </li>
                  );
                })}
                <li className="flex justify-between gap-3">
                  <span>Agravamento de spread sem rácios ESG</span>
                  <span className={FIGURE}>{formatBasisPoints(catalog.spreadPenaltyBps)} ao ano</span>
                </li>
              </ul>
            </div>
          </details>
        </div>

        <Metrics>
          <Metric
            wide
            label="Penalização bancária"
            value={formatApproxPerYear(result.estimatedSpreadPenalty)}
            title={exactValueTitle(result.estimatedSpreadPenalty, '/ano')}
            tone={result.estimatedSpreadPenalty > 0 ? 'amber' : 'plain'}
            size="sm"
          >
            {creditAmountMissing
              ? 'Falta o montante a refinanciar'
              : creditLineToRefinance <= 0
                ? 'Sem refinanciamento'
                : result.evaluations.some((e) => e.requirement.code === 'banking_esg' && e.status === 'compliant')
                  ? 'Com rácios ESG, sem agravamento'
                  : `${formatBasisPoints(catalog.spreadPenaltyBps)} ao ano sobre ${formatEUR(creditLineToRefinance)}`}
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
        </Metrics>

        {suggestedTasks.length > 0 && (
          <div className="border-t border-slate-200">
            <p className="px-4 pb-1 pt-3 text-2xs font-medium uppercase tracking-wide text-slate-600">Plano sugerido</p>
            <ul className="divide-y divide-slate-100">
              {PHASES.flatMap((phase) =>
                suggestedTasks
                  .filter((task) => task.phase === phase)
                  .map((task) => (
                    <PlanRow key={task.requirementCode} phase={phase} title={task.title}>
                      <ExecutorBadge executor={task.executorType} short />
                      <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-slate-900">
                        {formatEUR(task.estimatedCost)}
                      </span>
                    </PlanRow>
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
    ),
  };
}

// ── Sem sessão ──────────────────────────────────────────────────────────────────────

function publicPreview(source: Extract<PreviewSource, { kind: 'public' }>, creditAmountMissing: boolean): PreviewParts {
  if (source.error && !source.simulation) {
    return {
      headline: { kind: 'missing', reason: 'Cálculo indisponível.' },
      body: padded(<ErrorBanner title="Não foi possível calcular." message={source.error} onRetry={source.onRetry} />),
    };
  }
  if (!source.simulation) return { headline: { kind: 'loading' }, body: <PreviewSkeleton /> };

  const { commercialRisk, spreadPenalty, sectorBlocker, gaps, gapCount, criticalGapCount, exposedClientRevenue } =
    source.simulation;

  return {
    headline: {
      kind: 'value',
      text: commercialRisk ? formatEuroRange(commercialRisk.low, commercialRisk.high) : formatEUR(0),
      alarming: commercialRisk !== null,
      stale: source.updating,
      detail: (
        <>
          {commercialRisk && (
            <>
              <span className={FIGURE}>
                {commercialRisk.lowShare}–{commercialRisk.highShare}%
              </span>{' '}
              da faturação nos 3 maiores clientes ·{' '}
            </>
          )}
          base exposta <span className={FIGURE}>{formatEUR(exposedClientRevenue)}</span>
        </>
      ),
    },
    body: (
      <div aria-busy={source.updating} className={cn('transition-opacity', source.updating && 'opacity-60')}>
        {(source.error || sectorBlocker || gapCount === 0) && (
          <div className="space-y-3 px-4 py-4">
            {source.error && <ErrorBanner title="Não foi possível atualizar." message={source.error} onRetry={source.onRetry} />}
            {sectorBlocker && (
              <Blocker>
                <span className="font-semibold">Bloqueio setorial.</span> {sectorBlocker}
              </Blocker>
            )}
            {gapCount === 0 && <AllClear />}
          </div>
        )}

        <Metrics>
          <Metric
            wide
            label="Penalização bancária"
            value={spreadPenalty ? `${formatEuroRange(spreadPenalty.low, spreadPenalty.high)}/ano` : `${formatEUR(0)}/ano`}
            tone={spreadPenalty ? 'amber' : 'plain'}
            size="xs"
          >
            {creditAmountMissing ? 'falta o montante a refinanciar' : spreadPenalty ? 'agravamento de spread' : 'sem agravamento'}
          </Metric>
          <Metric label="Lacunas" value={String(gapCount)} tone={criticalGapCount > 0 ? 'rose' : 'plain'}>
            {criticalGapCount} {criticalGapCount === 1 ? 'crítica' : 'críticas'}
          </Metric>
          <Metric label="Investimento" value="Preço fechado" size="xs">
            na proposta
          </Metric>
        </Metrics>

        {gaps.length > 0 && (
          <div className="border-t border-slate-200">
            <p className="px-4 pb-1 pt-3 text-2xs font-medium uppercase tracking-wide text-slate-600">O que falta</p>
            <ul className="divide-y divide-slate-100">
              {PHASES.flatMap((phase) =>
                gaps
                  .filter((gap) => gap.phase === phase)
                  .map((gap) => (
                    <PlanRow key={gap.code} phase={phase} title={gap.solutionTitle} hint={`${gap.solutionTitle} (exigido por ${gap.requiredByLabel})`}>
                      {gap.critical && <Badge tone="critical">Crítica</Badge>}
                      <ExecutorBadge executor={gap.executorType} short />
                    </PlanRow>
                  )),
              )}
            </ul>
          </div>
        )}

        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
          Ordem de grandeza. O valor estimado, o plano e o preço fechado ficam no diagnóstico completo.
        </p>
      </div>
    ),
  };
}

// ── Partes comuns ───────────────────────────────────────────────────────────────────

function ScoreBar({ score, className }: { score: number; className?: string }) {
  return (
    <div className={className}>
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

/**
 * Os três indicadores lado a lado. Em ecrãs de telemóvel não cabem: o primeiro, que leva o
 * valor mais comprido, ocupa a largura toda e os outros dois ficam por baixo.
 */
function Metrics({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 border-t border-slate-200 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:divide-x sm:divide-slate-200 max-sm:[&>div:nth-child(2)]:border-r max-sm:[&>div:nth-child(2)]:border-slate-200">
      {children}
    </dl>
  );
}

function Metric({
  label,
  value,
  title,
  tone = 'plain',
  size = 'base',
  wide = false,
  children,
}: {
  label: string;
  value: string;
  title?: string;
  tone?: 'plain' | 'rose' | 'amber';
  /** Valores compridos (com «/ano», escalões, texto) usam corpo mais pequeno para caberem na coluna. */
  size?: 'base' | 'sm' | 'xs';
  /** Ocupa a largura toda quando os três indicadores não cabem lado a lado. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0 px-3 py-3', wide && 'max-sm:col-span-2 max-sm:border-b max-sm:border-slate-200')}>
      <dt className="text-2xs font-medium uppercase tracking-wide text-slate-600">{label}</dt>
      <dd
        title={title}
        className={cn(
          // Um valor fora do comum parte a linha em vez de sair da coluna.
          'mt-1 font-mono font-semibold tabular-nums [overflow-wrap:anywhere]',
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

/** Linha do plano. Ao lado do formulário o título é abreviado; em ecrãs estreitos, sem rato para o ler por extenso, parte a linha. */
function PlanRow({ phase, title, hint = title, children }: { phase: TaskPhase; title: string; hint?: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 px-4 py-1.5">
      <span className="w-11 shrink-0 font-mono text-2xs tabular-nums text-slate-600">{PHASE_SHORT_LABELS[phase]}</span>
      <span className="min-w-0 flex-1 text-xs text-slate-900 [overflow-wrap:anywhere] lg:truncate" title={hint}>
        {title}
      </span>
      {children}
    </li>
  );
}

function BudgetLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-1">
      <dt className="text-slate-600">{label}</dt>
      <dd className={cn('font-mono tabular-nums text-slate-900', strong && 'font-semibold')}>{formatEUR(value)}</dd>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 p-4" aria-busy="true" aria-label="A calcular">
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </div>
  );
}
