import type { UseQueryResult } from '@tanstack/react-query';
import { KeyRound, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import type { ManagedUser, PasswordLink } from '@engine/models/api.types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCreatePasswordLink, useUpdateUser } from '@/hooks/useUsers';
import { errorMessage } from '@/lib/api';
import { ROLE_LABELS, formatDateTimePt } from '@/lib/formatters';
import { useSession } from '@/lib/session';
import { PasswordLinkBox } from './PasswordLinkBox';

interface UserTableProps {
  query: UseQueryResult<ManagedUser[], Error>;
  showRole?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onInvite: () => void;
}

export function UserTable({ query, showRole = false, emptyTitle, emptyDescription, onInvite }: UserTableProps) {
  const session = useSession();
  const updateUser = useUpdateUser();
  const createLink = useCreatePasswordLink();
  const [issued, setIssued] = useState<{ link: PasswordLink; user: ManagedUser } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = updateUser.isPending || createLink.isPending;

  if (query.isPending) return <UserTableSkeleton />;
  if (query.isError) {
    return (
      <ErrorBanner
        title="Não foi possível carregar os utilizadores."
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={emptyTitle}
        description={emptyDescription}
        action={
          <Button size="sm" onClick={onInvite}>
            <UserPlus aria-hidden /> Convidar utilizador
          </Button>
        }
      />
    );
  }

  const generateLink = (user: ManagedUser) => {
    setError(null);
    createLink.mutate(user.id, {
      onSuccess: (link) => setIssued({ link, user }),
      onError: (cause) => setError(errorMessage(cause)),
    });
  };
  const setActive = (user: ManagedUser, isActive: boolean) => {
    setError(null);
    updateUser.mutate({ id: user.id, patch: { isActive } }, { onError: (cause) => setError(errorMessage(cause)) });
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner title="A alteração não foi feita." message={error} />}
      <div className="overflow-hidden rounded-md border border-slate-200">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="border-t-0">
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              {showRole && <TableHead>Papel</TableHead>}
              <TableHead>Estado</TableHead>
              <TableHead numeric>Último acesso</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map((user) => {
              const self = user.id === session?.user.id;
              return (
                <TableRow key={user.id} className="hover:bg-slate-50">
                  <TableCell className="font-medium text-slate-900">
                    {user.fullName}
                    {self && <span className="ml-1.5 text-xs font-normal text-slate-600">(a sua conta)</span>}
                  </TableCell>
                  <TableCell className="text-slate-700">{user.email}</TableCell>
                  {showRole && <TableCell className="text-slate-700">{ROLE_LABELS[user.role]}</TableCell>}
                  <TableCell>
                    <StatusBadge user={user} />
                  </TableCell>
                  <TableCell numeric className="text-xs text-slate-900">
                    {formatDateTimePt(user.lastLoginAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      {user.status !== 'disabled' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => generateLink(user)}
                          aria-label={`Gerar link de palavra-passe para ${user.fullName}`}
                        >
                          <KeyRound aria-hidden />
                          {user.status === 'invited' ? 'Novo convite' : 'Recuperar palavra-passe'}
                        </Button>
                      )}
                      {!self &&
                        (user.status === 'disabled' ? (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => setActive(user, true)}>
                            Reativar
                          </Button>
                        ) : (
                          <Button variant="danger" size="sm" disabled={busy} onClick={() => setActive(user, false)}>
                            Desativar
                          </Button>
                        ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Sheet open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <SheetContent aria-describedby="issued-link-description">
          <SheetHeader>
            <SheetTitle>Link de palavra-passe</SheetTitle>
            <SheetDescription id="issued-link-description">
              Os links anteriores desta pessoa deixaram de funcionar.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>{issued && <PasswordLinkBox link={issued.link} fullName={issued.user.fullName} />}</SheetBody>
          <SheetFooter>
            <span />
            <Button variant="outline" size="sm" onClick={() => setIssued(null)}>
              Fechar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusBadge({ user }: { user: ManagedUser }) {
  if (user.status === 'disabled') return <Badge tone="neutral">Desativada</Badge>;
  if (user.status === 'active') return <Badge tone="success">Ativa</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="high">Convite pendente</Badge>
      <span className="text-xs text-slate-600">
        {user.pendingLinkExpiresAt ? (
          <>
            link válido até <span className="font-mono tabular-nums text-slate-900">{formatDateTimePt(user.pendingLinkExpiresAt)}</span>
          </>
        ) : (
          'link expirado'
        )}
      </span>
    </div>
  );
}

function UserTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200" aria-busy="true" aria-label="A carregar utilizadores">
      <div className="bg-slate-50 px-3 py-2.5">
        <Skeleton className="h-3 w-64" />
      </div>
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row} className="flex items-center gap-6 border-t border-slate-200 px-3 py-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="ml-auto h-7 w-44" />
        </div>
      ))}
    </div>
  );
}
