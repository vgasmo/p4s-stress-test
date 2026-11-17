import type { TaskChanges } from '@/hooks/useTasks';
import { summarizeFailures } from '@/lib/task-changes';
import { Notice } from './Notice';

/**
 * Alterações do plano que o servidor não gravou. Ficam todas à vista, com a tarefa e o que se
 * tentou mudar, e «Tentar novamente» repete todas.
 */
export function FailedChangesNotice({ changes }: { changes: TaskChanges }) {
  if (changes.failed.length === 0) return null;
  const summary = summarizeFailures(changes.failed);
  return (
    <Notice title={summary.title} onRetry={changes.retry} retrying={changes.saving} onDismiss={changes.dismiss}>
      {summary.message && <p className="text-xs text-rose-800">{summary.message}</p>}
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-rose-900">
        {summary.lines.map((line) => (
          <li key={line.seq}>{line.text}</li>
        ))}
      </ul>
    </Notice>
  );
}
