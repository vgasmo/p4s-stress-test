import { History } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/states';
import { errorMessage } from '@/lib/api';
import { formatDateTimePt, formatEUR, sectorLabel } from '@/lib/formatters';
import { differencesFromRecord, type CompanyRecord, type PreviousAnswers } from './previous-answers';
import { usePreviousDiagnosis } from './usePreviousDiagnosis';

interface PreviousDiagnosisOfferProps {
  /** Setor e faturação da ficha da empresa. */
  record: CompanyRecord;
  /** Setor e faturação que estão agora no formulário. */
  current: CompanyRecord;
  /** O consultor já mexeu no formulário: as respostas dele são substituídas. */
  touched: boolean;
  onApply: (answers: PreviousAnswers) => void;
  onUseRecord: (record: Partial<CompanyRecord>) => void;
}

/**
 * Equipa P4S, numa empresa que já tem um diagnóstico: oferece partir das respostas dele. O
 * formulário abre sempre com tudo por fazer e as respostas anteriores só entram a pedido.
 */
export function PreviousDiagnosisOffer({ record, current, touched, onApply, onUseRecord }: PreviousDiagnosisOfferProps) {
  const { latest, answers } = usePreviousDiagnosis();
  const [applied, setApplied] = useState<{ when: string; answers: PreviousAnswers } | null>(null);
  // Os botões desta oferta desaparecem ao serem usados: o foco passa para o texto que os substitui.
  const appliedRef = useRef<HTMLDivElement>(null);
  const focusApplied = () => requestAnimationFrame(() => appliedRef.current?.focus());

  if (applied) {
    // Só enquanto o setor e a faturação aplicados ainda estiverem no formulário.
    const differs = differencesFromRecord(applied.answers, record);
    const sector = differs.sector && current.sectorProfile === applied.answers.sectorProfile;
    const revenue = differs.revenue && current.annualRevenue === applied.answers.annualRevenue;
    return (
      <div
        ref={appliedRef}
        tabIndex={-1}
        role="status"
        className="mt-3 space-y-2 rounded-sm border-t border-slate-200 pt-3 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        data-testid="previous-diagnosis-applied"
      >
        <p>
          <span className="font-medium text-slate-900">Respostas do diagnóstico de {applied.when} aplicadas.</span> Mude o que
          for diferente e guarde como diagnóstico novo.
        </p>
        {(sector || revenue) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
            <p className="min-w-0 flex-1 basis-64">
              {sector && revenue
                ? 'O setor e a faturação aplicados são os desse diagnóstico.'
                : sector
                  ? 'O setor aplicado é o desse diagnóstico.'
                  : 'A faturação aplicada é a desse diagnóstico.'}{' '}
              A ficha da empresa tem agora{' '}
              <span className="font-medium">
                {[sector ? sectorLabel(record.sectorProfile) : null, revenue ? formatEUR(record.annualRevenue) : null]
                  .filter(Boolean)
                  .join(' e ')}
              </span>
              .
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onUseRecord({
                  ...(sector ? { sectorProfile: record.sectorProfile } : {}),
                  ...(revenue ? { annualRevenue: record.annualRevenue } : {}),
                });
                focusApplied();
              }}
            >
              Usar os dados da ficha
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!latest) return null;
  const when = formatDateTimePt(latest.createdAt);
  const load = () =>
    answers.mutate(latest.id, {
      onSuccess: (read) => {
        onApply(read);
        setApplied({ when, answers: read });
        focusApplied();
      },
    });

  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs text-slate-700" data-testid="previous-diagnosis-offer">
      <p>
        Esta empresa tem um diagnóstico de <span className="font-mono tabular-nums text-slate-900">{when}</span> (score{' '}
        <span className="font-mono tabular-nums text-slate-900">{latest.riskScore}</span>
        {latest.conductedByName ? `, feito por ${latest.conductedByName}` : ''}).{' '}
        {touched
          ? 'Pode partir das respostas desse diagnóstico. As que já deu neste formulário são substituídas.'
          : 'Este formulário abre com tudo por fazer. Numa revisão, parta das respostas desse diagnóstico e mude só o que for diferente.'}
      </p>
      {answers.isError && (
        <ErrorBanner
          title="Não foi possível carregar as respostas desse diagnóstico."
          message={errorMessage(answers.error)}
          onRetry={load}
          retrying={answers.isPending}
        />
      )}
      <Button size="sm" variant="outline" onClick={load} disabled={answers.isPending}>
        <History aria-hidden />
        {answers.isPending ? 'A carregar as respostas…' : `Partir das respostas de ${when}`}
      </Button>
    </div>
  );
}
