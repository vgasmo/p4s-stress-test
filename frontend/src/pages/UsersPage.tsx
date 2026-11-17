import { Building2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { InviteUserSheet } from '@/components/users/InviteUserSheet';
import { UserTable } from '@/components/users/UserTable';
import { useMe } from '@/hooks/useAuth';
import { useCompanyUsers, useTeam } from '@/hooks/useUsers';
import { isStaffSession, useSession } from '@/lib/session';

/** Gestão de utilizadores. Só para a equipa P4S. */
export function UsersPage() {
  const session = useSession();
  const me = useMe();
  const isAdmin = session?.user.role === 'admin';
  const companyUsers = useCompanyUsers();
  const team = useTeam(isAdmin);
  const [invite, setInvite] = useState<'company' | 'team' | null>(null);

  if (!isStaffSession(session)) return <Navigate to="/plano" replace />;

  const companyName = me.data?.company?.name;

  return (
    <div className="space-y-4">
      <header className="max-w-3xl">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">Acessos</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">Utilizadores</h1>
        <p className="mt-1 text-sm text-slate-700">
          Cada conta é criada sem palavra-passe. A pessoa define-a com um link de uso único, que serve também para a
          recuperar. Não é enviado nenhum email automático: o link é entregue por si.
        </p>
      </header>

      <Card>
        <CardHeader className="items-center">
          <div>
            <CardTitle>{companyName ? `Utilizadores de ${companyName}` : 'Utilizadores da empresa'}</CardTitle>
            <CardDescription>Veem o plano da empresa, atualizam o estado das tarefas e criam tarefas internas.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setInvite('company')} disabled={!session?.companyId}>
            <UserPlus aria-hidden /> Convidar utilizador
          </Button>
        </CardHeader>
        <CardContent>
          {session?.companyId ? (
            <UserTable
              query={companyUsers}
              emptyTitle="Esta empresa ainda não tem utilizadores"
              emptyDescription="Convide o administrador da fábrica para acompanhar o plano e o estado das tarefas."
              onInvite={() => setInvite('company')}
            />
          ) : (
            <EmptyState
              icon={Building2}
              title="Escolha a empresa cliente"
              description="Selecione a empresa no topo para ver e convidar os utilizadores dela."
            />
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader className="items-center">
            <div>
              <CardTitle>Equipa Plan4Sustain</CardTitle>
              <CardDescription>Administradores e consultores. Trabalham sobre todas as empresas clientes.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setInvite('team')}>
              <UserPlus aria-hidden /> Convidar para a equipa
            </Button>
          </CardHeader>
          <CardContent>
            <UserTable
              query={team}
              showRole
              emptyTitle="Sem contas na equipa"
              emptyDescription="Convide os consultores que vão fazer diagnósticos."
              onInvite={() => setInvite('team')}
            />
          </CardContent>
        </Card>
      )}

      <InviteUserSheet
        open={invite !== null}
        onOpenChange={(open) => !open && setInvite(null)}
        scope={invite ?? 'company'}
        companyName={companyName}
      />
    </div>
  );
}
