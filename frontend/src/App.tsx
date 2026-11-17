import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useSession } from '@/lib/session';
import { ActionPlanPage } from '@/pages/ActionPlanPage';
import { LoginPage } from '@/pages/LoginPage';
import { StressTestPage } from '@/pages/StressTestPage';

function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (!session) return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route
        element={
          <AppShell>
            <Outlet />
          </AppShell>
        }
      >
        <Route path="/" element={<StressTestPage />} />
        <Route path="/entrar" element={<LoginPage />} />
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
