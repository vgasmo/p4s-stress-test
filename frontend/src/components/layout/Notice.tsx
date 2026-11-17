// Aviso com mais do que o ErrorBanner leva: uma lista, a opção de fechar ou um tom de alerta.
// Mesmas cores e medidas, para os avisos da aplicação se lerem todos da mesma maneira.

import { AlertTriangle, RotateCcw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TONES = {
  error: {
    box: 'border-rose-200 bg-rose-50 text-rose-900',
    icon: 'text-rose-700',
    dismiss: 'text-rose-900 hover:bg-rose-100 hover:text-rose-950',
  },
  warning: {
    box: 'border-amber-300 bg-amber-50 text-amber-950',
    icon: 'text-amber-700',
    dismiss: 'text-amber-950 hover:bg-amber-100 hover:text-amber-950',
  },
} as const;

interface NoticeProps {
  tone?: keyof typeof TONES;
  /** alert interrompe o leitor de ecrã (erros). status espera a vez (estado da ligação). */
  role?: 'alert' | 'status';
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  onDismiss?: () => void;
  className?: string;
  testId?: string;
}

export function Notice({
  tone = 'error',
  role = 'alert',
  icon: Icon = AlertTriangle,
  title,
  children,
  onRetry,
  retrying,
  onDismiss,
  className,
  testId,
}: NoticeProps) {
  const colors = TONES[tone];
  return (
    <div
      role={role}
      data-testid={testId}
      className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-3 py-2.5', colors.box, className)}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', colors.icon)} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
      {(onRetry || onDismiss) && (
        <div className="ml-auto flex shrink-0 gap-2">
          {onRetry && (
            // aria-disabled em vez de disabled: um botão desativado perde o foco, e quem usa o
            // teclado ficava sem saber onde estava quando a nova tentativa acabasse.
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
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss} className={colors.dismiss}>
              Fechar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
