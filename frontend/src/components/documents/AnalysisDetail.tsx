// Um documento analisado: o resumo e as exigências, cada uma com a frase do documento que a
// sustenta. É aqui que o consultor decide o que passa a evidência no plano do cliente.

import { AlertTriangle, Check, CheckCircle2, RotateCcw, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { DocumentAnalysisDetail, DocumentFinding } from '@engine/models/api.types';
import { REQUIREMENTS, type RequirementCode } from '@engine/services/requirements';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteDocument, useDocument, useReviewFinding } from '@/hooks/useDocuments';
import { ApiError, errorMessage } from '@/lib/api';
import {
  NO_REQUIREMENT,
  NO_REQUIREMENT_LABEL,
  OBLIGATION_LABELS,
  countsLabel,
  deadlineLabel,
  documentOrigin,
  formatFileSize,
} from '@/lib/documents';
import { formatDateTimePt } from '@/lib/formatters';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { cn } from '@/lib/utils';

interface AnalysisDetailProps {
  analysisId: string;
  /** O documento deixou de existir (eliminado aqui ou por outra pessoa). */
  onGone: () => void;
}

export function AnalysisDetail({ analysisId, onGone }: AnalysisDetailProps) {
  const query = useDocument(analysisId);

  if (query.isPending) return <AnalysisSkeleton label="A carregar o documento" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title="Este documento já não existe"
          description="Foi eliminado ou pertence a outra empresa."
          action={
            <Button size="sm" variant="outline" onClick={onGone}>
              Voltar à lista
            </Button>
          }
        />
      );
    }
    return (
      <ErrorBanner
        title="Não foi possível carregar o documento."
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const analysis = query.data;
  const origin = documentOrigin(analysis);

  return (
    <Card data-testid="analysis-detail">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="break-words">{analysis.fileName}</CardTitle>
          <CardDescription>
            {[
              origin,
              analysis.documentLanguage ? `em ${analysis.documentLanguage}` : null,
              analysis.pageCount ? `${analysis.pageCount} ${analysis.pageCount === 1 ? 'página' : 'páginas'}` : null,
              formatFileSize(analysis.fileSize),
            ]
              .filter(Boolean)
              .join(' · ')}
          </CardDescription>
          <CardDescription>
            Carregado em {formatDateTimePt(analysis.createdAt)}
            {analysis.uploadedByName ? ` por ${analysis.uploadedByName}` : ''}
            {analysis.model ? ` · analisado por ${analysis.model}` : ''}
          </CardDescription>
        </div>
        <DeleteDocument analysisId={analysis.id} confirmedCount={analysis.findingCounts.confirmed} onDeleted={onGone} />
      </CardHeader>

      {analysis.status === 'processing' && (
        <CardContent className="space-y-3" aria-busy="true">
          <p className="text-sm text-slate-700" role="status">
            A IA está a ler o documento. Costuma demorar um a dois minutos, e pode sair deste ecrã entretanto.
          </p>
          <FindingSkeletons />
        </CardContent>
      )}

      {analysis.status === 'failed' && (
        <CardContent>
          <ErrorBanner
            title="A análise não terminou."
            message={`${analysis.failureMessage ?? 'Erro desconhecido.'} Para tentar de novo, elimine este registo e carregue o documento outra vez.`}
          />
        </CardContent>
      )}

      {analysis.status === 'done' && <Findings analysis={analysis} />}
    </Card>
  );
}

function Findings({ analysis }: { analysis: DocumentAnalysisDetail }) {
  const { findingCounts: counts, findings } = analysis;
  return (
    <>
      <CardContent className="space-y-2 border-b border-slate-200">
        {analysis.summary && <p className="max-w-prose text-sm text-slate-800">{analysis.summary}</p>}
        <p className="text-xs font-medium text-slate-900" data-testid="finding-counts">
          {countsLabel(counts)}
        </p>
        {counts.unverified > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-amber-900" data-testid="unverified-warning">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
            <span>
              {counts.unverified === 1 ? 'Há uma citação que não foi encontrada' : `Há ${counts.unverified} citações que não foram encontradas`}{' '}
              no texto do documento. Essas exigências não podem ser confirmadas: veja o original antes de as usar.
            </span>
          </p>
        )}
        {counts.total > 0 && (
          <p className="max-w-prose text-xs text-slate-600">
            O levantamento é feito por IA e pode ter falhas ou deixar exigências de fora. Leia cada citação antes de
            confirmar. Só as confirmadas, e que correspondem a um requisito do stress test, aparecem no plano do cliente.
          </p>
        )}
      </CardContent>
      {findings.length === 0 ? (
        <CardContent>
          <p className="text-sm text-slate-700">
            A IA não encontrou exigências feitas ao fornecedor neste documento. Se estava à espera de as encontrar, confirme no
            original: o levantamento pode ter falhado.
          </p>
        </CardContent>
      ) : (
        <ol className="divide-y divide-slate-200">
          {findings.map((finding) => (
            <FindingItem key={finding.id} analysisId={analysis.id} finding={finding} paged={analysis.pageCount !== null} />
          ))}
        </ol>
      )}
    </>
  );
}

const REVIEW_BADGE = {
  confirmed: { tone: 'success', label: 'Confirmada' },
  rejected: { tone: 'outline', label: 'Rejeitada' },
} as const;

function FindingItem({ analysisId, finding, paged }: { analysisId: string; finding: DocumentFinding; paged: boolean }) {
  const review = useReviewFinding();
  const selectId = useId();
  const deadline = deadlineLabel(finding);
  const decided = finding.reviewStatus !== 'pending';
  const reclassified = finding.requirementCode !== finding.suggestedRequirementCode;
  const busy = review.isPending;

  const decide = (patch: Parameters<typeof review.mutate>[0]['patch']) => review.mutate({ analysisId, findingId: finding.id, patch });

  return (
    <li
      className={cn('space-y-2 px-4 py-3', finding.reviewStatus === 'rejected' && 'bg-slate-50/70')}
      data-testid="finding"
      data-review={finding.reviewStatus}
      data-verified={finding.quoteVerified}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-2xs tabular-nums text-slate-500">{finding.position}</span>
        <h3 className={cn('text-sm font-semibold', finding.reviewStatus === 'rejected' ? 'text-slate-600 line-through' : 'text-slate-900')}>
          {finding.topic}
        </h3>
        <Badge tone={finding.obligation === 'mandatory' ? 'critical' : finding.obligation === 'recommended' ? 'neutral' : 'high'}>
          {OBLIGATION_LABELS[finding.obligation]}
        </Badge>
        {decided && <Badge tone={REVIEW_BADGE[finding.reviewStatus as 'confirmed' | 'rejected'].tone}>{REVIEW_BADGE[finding.reviewStatus as 'confirmed' | 'rejected'].label}</Badge>}
      </div>

      <p className="max-w-prose text-sm text-slate-800">{finding.request}</p>

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
        <div>
          <dt className="inline text-slate-600">Prazo </dt>
          <dd className="inline font-medium text-slate-900">{deadline ?? 'não indicado no documento'}</dd>
        </div>
        {finding.consequence && (
          <div>
            <dt className="inline text-slate-600">Se não cumprir </dt>
            <dd className="inline font-medium text-slate-900">{finding.consequence}</dd>
          </div>
        )}
      </dl>

      <figure
        className={cn(
          'max-w-prose rounded-md border-l-2 px-3 py-2',
          finding.quoteVerified ? 'border-emerald-600 bg-emerald-50/50' : 'border-amber-500 bg-amber-50',
        )}
      >
        <blockquote className="text-sm italic text-slate-900" lang="">
          «{finding.quote}»
        </blockquote>
        <figcaption className={cn('mt-1 flex items-start gap-1.5 text-xs', finding.quoteVerified ? 'text-emerald-900' : 'text-amber-900')}>
          {finding.quoteVerified ? (
            <>
              <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-emerald-700" />
              <span>
                Citação encontrada no documento
                {finding.quotePage ? `, na página ${finding.quotePage}` : paged ? '' : ' (este formato não tem páginas)'}.
              </span>
            </>
          ) : (
            <>
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
              <span>
                Esta frase não foi encontrada no texto do documento. Pode ter sido alterada ou inventada pela IA. Não pode ser
                confirmada: veja o original e, se a exigência existir, registe-a no plano à mão.
              </span>
            </>
          )}
        </figcaption>
      </figure>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="w-full sm:w-72">
          <label htmlFor={selectId} className="text-xs font-medium text-slate-700">
            Requisito do stress test
          </label>
          <Select
            id={selectId}
            className="h-8 text-xs"
            disabled={busy}
            value={finding.requirementCode ?? NO_REQUIREMENT}
            onChange={(event) =>
              decide({ requirementCode: event.target.value === NO_REQUIREMENT ? null : (event.target.value as RequirementCode) })
            }
          >
            {REQUIREMENTS.map((requirement) => (
              <option key={requirement.code} value={requirement.code}>
                {requirement.label}
              </option>
            ))}
            <option value={NO_REQUIREMENT}>{NO_REQUIREMENT_LABEL}</option>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          {finding.reviewStatus === 'pending' ? (
            <>
              <Button
                size="sm"
                disabled={busy || !finding.quoteVerified}
                title={finding.quoteVerified ? undefined : 'A citação não foi encontrada no documento'}
                onClick={() => decide({ reviewStatus: 'confirmed' })}
              >
                <Check aria-hidden /> Confirmar
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => decide({ reviewStatus: 'rejected' })}>
                <X aria-hidden /> Rejeitar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide({ reviewStatus: 'pending' })}>
              <RotateCcw aria-hidden /> Voltar a rever
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        {decided && finding.reviewedByName
          ? `${finding.reviewStatus === 'confirmed' ? 'Confirmada' : 'Rejeitada'} por ${finding.reviewedByName} em ${formatDateTimePt(finding.reviewedAt)}. `
          : ''}
        {reclassified ? 'Reclassificada pelo consultor. ' : ''}
        {finding.reviewStatus === 'confirmed' && finding.requirementCode === null
          ? 'Confirmada, mas fora dos requisitos do stress test: fica aqui registada e não aparece na matriz do plano.'
          : ''}
      </p>
      {review.isError && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          A alteração não ficou gravada. {errorMessage(review.error)}
        </p>
      )}
    </li>
  );
}

function DeleteDocument({ analysisId, confirmedCount, onDeleted }: { analysisId: string; confirmedCount: number; onDeleted: () => void }) {
  const remove = useDeleteDocument();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden /> Eliminar
      </Button>
    );
  }
  return (
    <div role="group" aria-label="Confirmar eliminação do documento" className="flex shrink-0 flex-col items-end gap-1.5">
      <p className="max-w-56 text-right text-xs text-slate-700">
        {confirmedCount > 0
          ? `O levantamento e ${confirmedCount === 1 ? 'a exigência confirmada saem' : `as ${confirmedCount} exigências confirmadas saem`} do plano do cliente.`
          : 'O levantamento deixa de existir.'}
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(analysisId, { onSuccess: onDeleted })}>
          <Trash2 aria-hidden /> {remove.isPending ? 'A eliminar…' : 'Eliminar'}
        </Button>
        <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => setConfirming(false)} autoFocus>
          Cancelar
        </Button>
      </div>
      {remove.isError && <p className="text-xs font-medium text-rose-700">{errorMessage(remove.error)}</p>}
    </div>
  );
}

function FindingSkeletons() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="h-3 w-full max-w-prose" />
          <Skeleton className="h-10 w-full max-w-prose" />
        </div>
      ))}
    </div>
  );
}

export function AnalysisSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white" aria-busy="true" aria-label={label}>
      <div className="space-y-2 border-b border-slate-200 px-4 py-3">
        <Skeleton className="h-3.5 w-64" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="p-4">
        <FindingSkeletons />
      </div>
    </div>
  );
}
