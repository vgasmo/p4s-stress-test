// A evidência de um requisito no plano: quem o pede por escrito, até quando, e a frase do
// documento. Fechada por omissão, para a matriz continuar a ler-se de relance.

import { Quote } from 'lucide-react';
import type { RequirementEvidence } from '@engine/models/api.types';
import { OBLIGATION_LABELS, deadlineShort, evidenceHeadline, evidenceSource } from '@/lib/documents';
import { cn } from '@/lib/utils';

export function EvidenceList({ items, className }: { items: readonly RequirementEvidence[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <details className={cn('group text-xs', className)} data-testid={`evidence-${items[0]?.requirementCode}`}>
      <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded font-medium text-slate-800 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
        <Quote aria-hidden className="size-3 shrink-0 text-emerald-700" />
        <span>{evidenceHeadline(items)}</span>
        <span className="font-normal text-slate-600 group-open:hidden">· ver {items.length === 1 ? 'a citação' : `as ${items.length} citações`}</span>
      </summary>
      <ul className="mt-1.5 space-y-2">
        {items.map((item) => {
          const deadline = deadlineShort(item);
          return (
            <li key={item.findingId} className="border-l-2 border-emerald-600 pl-2.5">
              <p className="text-slate-900">
                {item.request}{' '}
                <span className="text-slate-600">
                  ({OBLIGATION_LABELS[item.obligation].toLowerCase()}
                  {deadline ? `, prazo ${deadline}` : ''})
                </span>
              </p>
              <blockquote className="mt-0.5 italic text-slate-700" lang="">
                «{item.quote}»
              </blockquote>
              <p className="mt-0.5 text-slate-600">{evidenceSource(item)}</p>
              {item.consequence && <p className="mt-0.5 text-slate-700">Se não cumprir: {item.consequence}</p>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
