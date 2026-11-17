// Lista dos documentos analisados para a empresa: o que é cada um e em que ponto está a revisão.

import { FileSearch, FileText } from 'lucide-react';
import type { DocumentAnalysisSummary } from '@engine/models/api.types';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { countsLabel, documentOrigin } from '@/lib/documents';
import { formatDateTimePt } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export function AnalysisStatusBadge({ analysis }: { analysis: DocumentAnalysisSummary }) {
  if (analysis.status === 'processing') return <Badge tone="high">A analisar…</Badge>;
  if (analysis.status === 'failed') return <Badge tone="danger">Falhou</Badge>;
  const { total, pending } = analysis.findingCounts;
  if (total === 0) return <Badge tone="outline">Sem exigências</Badge>;
  return pending > 0 ? <Badge tone="neutral">{pending} por rever</Badge> : <Badge tone="success">Revisto</Badge>;
}

interface DocumentListProps {
  analyses: DocumentAnalysisSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function DocumentList({ analyses, selectedId, onSelect }: DocumentListProps) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Documentos analisados</CardTitle>
          <CardDescription>
            {analyses.length === 0 ? 'Ainda nenhum para esta empresa.' : 'Escolha um para rever as exigências.'}
          </CardDescription>
        </div>
      </CardHeader>
      {analyses.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={FileSearch}
            title="Comece pelo questionário do cliente"
            description="É o documento que diz o que o cliente exige, até quando e com que consequência. O levantamento fica pronto em um a dois minutos."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-200" data-testid="document-list">
          {analyses.map((analysis) => {
            const selected = analysis.id === selectedId;
            return (
              <li key={analysis.id}>
                <button
                  type="button"
                  onClick={() => onSelect(analysis.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900',
                    selected ? 'bg-slate-100' : 'hover:bg-slate-50',
                  )}
                >
                  <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900" title={analysis.fileName}>
                      {analysis.fileName}
                    </span>
                    <span className="block truncate text-xs text-slate-600">
                      {documentOrigin(analysis) ?? `Carregado em ${formatDateTimePt(analysis.createdAt)}`}
                    </span>
                    {analysis.status === 'done' && (
                      <span className="block text-xs text-slate-600">{countsLabel(analysis.findingCounts)}</span>
                    )}
                  </span>
                  <span className="shrink-0">
                    <AnalysisStatusBadge analysis={analysis} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
