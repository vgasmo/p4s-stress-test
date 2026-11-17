import { useRef } from 'react';
import type { TaskChanges } from '@/hooks/useTasks';
import { focusAfter } from '@/lib/focus';
import { summarizeFailures } from '@/lib/task-changes';
import { Notice } from './Notice';

/**
 * Alterações do plano que o servidor não gravou. Ficam todas à vista, com a tarefa e o que se
 * tentou mudar, e «Tentar novamente» repete todas.
 */
export function FailedChangesNotice({ changes }: { changes: TaskChanges }) {
  const box = useRef<HTMLDivElement>(null);
  if (changes.failed.length === 0) return null;
  const summary = summarizeFailures(changes.failed);
  // O aviso sai do ecrã com o botão que foi usado: o foco segue para o plano, logo abaixo.
  const leaving = (action: () => void) => () => {
    if (box.current) focusAfter(box.current);
    action();
  };
  return (
    <div ref={box}>
      <Notice title={summary.title} onRetry={leaving(changes.retry)} retrying={changes.saving} onDismiss={leaving(changes.dismiss)}>
        {summary.message && <p className="text-xs text-rose-800">{summary.message}</p>}
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-rose-900">
          {summary.lines.map((line) => (
            <li key={line.seq}>{line.text}</li>
          ))}
        </ul>
      </Notice>
    </div>
  );
}
