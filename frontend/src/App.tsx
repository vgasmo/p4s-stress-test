import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { useSession } from '@/lib/session';
import { ActionPlanPage } from '@/pages/ActionPlanPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { LoginPage } from '@/pages/LoginPage';
import { SetPasswordPage } from '@/pages/SetPasswordPage';
import { StressTestPage } from '@/pages/StressTestPage';
import { UsersPage } from '@/pages/UsersPage';

function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (!session) return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

/**
 * Quando a pessoa com sessão muda sem passar pelo login deste separador (entrou ou saiu
 * noutro separador), os dados em memória são de quem lá estava antes: deitam-se fora.
 */
function useClearCacheWhenUserChanges(): void {
  const queryClient = useQueryClient();
  const userId = useSession()?.user.id ?? null;
  const previous = useRef(userId);
  useEffect(() => {
    if (previous.current === userId) return;
    previous.current = userId;
    queryClient.clear();
  }, [userId, queryClient]);
}

/** Cada ecrã dentro da sua própria barreira: um erro num deles não apaga a moldura nem os outros. */
function Screen() {
  const location = useLocation();
  useClearCacheWhenUserChanges();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Outlet />
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        element={
          <AppShell>
            <Screen />
          </AppShell>
        }
      >
        <Route path="/" element={<StressTestPage />} />
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/definir-palavra-passe" element={<SetPasswordPage />} />
        <Route
          path="/utilizadores"
          element={
            <RequireSession>
              <UsersPage />
            </RequireSession>
          }
        />
        <Route
          path="/documentos/:analysisId?"
          element={
            <RequireSession>
              <DocumentsPage />
            </RequireSession>
          }
        />
        <Route
          path="/plano/:assessmentId?"
          element={
            <RequireSession>
              <ActionPlanPage />
            </RequireSession>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
