import { KeyRound, LogOut } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChangePasswordSheet } from '@/components/users/ChangePasswordSheet';
import { useAuthActions } from '@/hooks/useAuth';
import { ROLE_LABELS } from '@/lib/formatters';
import { isStaffSession, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { CompanySwitcher } from './CompanySwitcher';
import { HeaderNotices } from './HeaderNotices';

export const FOOTER_SIGNATURE =
  'Conformidade documental para a cadeia de fornecimento: Pegada de Carbono, EcoVadis, Relatórios para a Banca e Segurança da Informação. Um só interlocutor, zero dispersão.';

export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight text-slate-900', className)}>
      <span aria-hidden className="grid size-5 grid-cols-2 gap-px rounded-sm bg-slate-900 p-[3px]">
        <span className="rounded-[1px] bg-white" />
        <span className="rounded-[1px] bg-emerald-400" />
        <span className="rounded-[1px] bg-emerald-400" />
        <span className="rounded-[1px] bg-white" />
      </span>
      <span className={compact ? 'hidden sm:inline' : undefined}>Plan4Sustain</span>
    </span>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
    isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  );

/**
 * Moldura da app, montada uma vez para todas as rotas. Quando a página tem uma vista de
 * impressão própria ([data-print-view]), a moldura não é impressa (regra em index.css).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const { logout } = useAuthActions();
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <div data-app-shell className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-12 max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 sm:gap-x-4 sm:px-6">
          <Link
            to="/"
            aria-label="Plan4Sustain, stress test"
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            <Wordmark compact />
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Stress test
            </NavLink>
            {session && (
              <NavLink to="/plano" className={navClass}>
                Plano de ação
              </NavLink>
            )}
            {isStaffSession(session) && (
              <NavLink to="/documentos" className={navClass}>
                Documentos
              </NavLink>
            )}
            {isStaffSession(session) && (
              <NavLink to="/utilizadores" className={navClass}>
                Utilizadores
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {isStaffSession(session) && <CompanySwitcher />}
            {session ? (
              <>
                <div className="hidden text-right leading-tight md:block">
                  <p className="text-xs font-medium text-slate-900">{session.user.fullName}</p>
                  <p className="text-2xs text-slate-600">{ROLE_LABELS[session.user.role]}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setChangingPassword(true)}
                  aria-label="Alterar palavra-passe"
                  title="Alterar palavra-passe"
                >
                  <KeyRound aria-hidden />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void logout()} aria-label="Terminar sessão">
                  <LogOut aria-hidden />
                  <span className="hidden sm:inline">Sair</span>
                </Button>
              </>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link to="/entrar">Entrar</Link>
              </Button>
            )}
          </div>
        </div>
        <HeaderNotices />
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      {session && <ChangePasswordSheet open={changingPassword} onOpenChange={setChangingPassword} />}

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-1 px-4 py-4 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="max-w-3xl">{FOOTER_SIGNATURE}</p>
          <p className="shrink-0 font-medium text-slate-700">Plan4Sustain</p>
        </div>
      </footer>
    </div>
  );
}
