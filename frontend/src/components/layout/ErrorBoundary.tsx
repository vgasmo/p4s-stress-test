import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { clearLocalData } from '@/lib/session';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Muda quando o utilizador navega: o ecrã seguinte volta a tentar em vez de ficar preso no erro. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  failed: boolean;
  resetKey: string | undefined;
}

/**
 * Um erro inesperado num ecrã (dados que a interface não esperava, por exemplo) mostra uma
 * mensagem com saída, em vez de deixar a página em branco.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] erro ao desenhar o ecrã', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-rose-900">
        <div className="flex items-start gap-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-rose-700" />
          <div>
            <p className="text-sm font-semibold">Este ecrã não conseguiu abrir.</p>
            <p className="mt-0.5 text-sm text-rose-800">
              Os seus dados não foram alterados. Volte ao início ou recarregue a página. Se voltar a acontecer, avise a
              equipa Plan4Sustain.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => window.location.assign('/')}>
                Voltar ao início
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Recarregar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Apaga a sessão e os rascunhos guardados neste browser. Os dados gravados no servidor não são afetados."
                onClick={() => {
                  clearLocalData();
                  window.location.assign('/entrar');
                }}
              >
                Terminar sessão e limpar dados locais
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
