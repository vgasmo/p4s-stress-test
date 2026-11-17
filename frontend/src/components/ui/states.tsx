// Estados de erro e vazio partilhados por todas as vistas (Regra dos 5 Estados).

import { AlertTriangle, RotateCcw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ErrorBannerProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function ErrorBanner({ title = 'Não foi possível concluir o pedido.', message, onRetry, retrying, className }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-900', className)}
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-rose-700" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-rose-800">{message}</p>
      </div>
      {onRetry && (
        <Button
          variant="danger"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="shrink-0"
        >
          <RotateCcw aria-hidden />
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/** Caixa estruturada, alinhada à esquerda, com ação primária imediata. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-4 sm:flex-row sm:items-center',
        className,
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
        <Icon aria-hidden className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 max-w-prose text-sm text-slate-600">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
