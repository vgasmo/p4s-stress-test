// Aviso de erro com mais do que o ErrorBanner leva: conteúdo livre (uma lista de alterações)
// e a opção de fechar. Mesmas cores e medidas, para os avisos se lerem todos da mesma maneira.

import { AlertTriangle, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface NoticeProps {
  title: string;
  children?: ReactNode;
  onRetry: () => void;
  /** A nova tentativa está em curso. */
  retrying: boolean;
  onDismiss: () => void;
  testId?: string;
}

export function Notice({ title, children, onRetry, retrying, onDismiss, testId }: NoticeProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-900"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-rose-700" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
      <div className="ml-auto flex shrink-0 gap-2">
        {/* aria-disabled em vez de disabled: um botão desativado perde o foco, e quem usa o
            teclado ficava sem saber onde estava quando a nova tentativa acabasse. */}
        <Button
          variant="danger"
          size="sm"
          aria-disabled={retrying || undefined}
          onClick={retrying ? undefined : onRetry}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <RotateCcw aria-hidden />
          Tentar novamente
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="text-rose-900 hover:bg-rose-100 hover:text-rose-950">
          Fechar
        </Button>
      </div>
    </div>
  );
}
