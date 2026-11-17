import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LinkIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isStaffRole } from '@engine/models/domain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorBanner } from '@/components/ui/states';
import { PasswordFields, passwordProblem } from '@/components/users/PasswordFields';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDateTimePt } from '@/lib/formatters';
import { sessionStore, useSession } from '@/lib/session';

/** O token vem no fragmento do endereço (#token=…), que o browser não envia a servidores. */
function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && token.length >= 20 ? token : null;
}

/** Página pública aberta pelo link de convite ou de recuperação. */
export function SetPasswordPage() {
  const { hash } = useLocation();
  const token = tokenFromHash(hash);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = useQuery({
    queryKey: ['password-link', token],
    queryFn: () => api.inspectPasswordLink(token as string),
    enabled: token !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const invalid = (
    <EmptyState
      icon={LinkIcon}
      title="Este link já não é válido"
      description="Pode já ter sido usado, ter expirado ou ter sido substituído por um mais recente. Peça um novo ao seu consultor Plan4Sustain."
      action={
        <Button asChild size="sm" variant="outline">
          <Link to="/entrar">Ir para a entrada</Link>
        </Button>
      }
    />
  );

  if (!token) return invalid;
  if (link.isPending) {
    return (
      <div className="max-w-md space-y-3" aria-busy="true" aria-label="A verificar o link">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  if (link.isError) {
    // 400: link gasto, expirado ou inexistente. Outros erros (rede, limite de pedidos) podem repetir-se.
    return link.error instanceof ApiError && link.error.status === 400 ? (
      invalid
    ) : (
      <ErrorBanner
        title="Não foi possível verificar o link."
        message={errorMessage(link.error)}
        onRetry={() => void link.refetch()}
        retrying={link.isFetching}
      />
    );
  }

  const info = link.data;
  const otherSession = session && session.user.email !== info.email ? session.user.fullName : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError(null);
    if (passwordProblem(password, confirmation)) return;
    setPending(true);
    try {
      const next = await api.setPassword(token, password);
      queryClient.clear();
      sessionStore.set(next);
      navigate(isStaffRole(next.user.role) ? '/' : '/plano', { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
      // O link pode ter sido gasto entretanto: volta a verificar para mostrar o estado certo.
      if (cause instanceof ApiError && cause.code === 'INVALID_PASSWORD_LINK') void link.refetch();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="max-w-xl">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">
          {info.purpose === 'invite' ? 'Convite' : 'Recuperação de palavra-passe'}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {info.purpose === 'invite' ? `Bem-vindo, ${info.fullName}` : `Nova palavra-passe para ${info.fullName}`}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          {info.purpose === 'invite'
            ? 'Defina a palavra-passe para entrar no stress test de qualificação da Plan4Sustain. Depois disso entra sempre com o seu email.'
            : 'Defina uma palavra-passe nova. As sessões abertas com a anterior terminam em poucos minutos.'}
        </p>
        <p className="mt-2 text-xs text-slate-600">
          Este link funciona uma só vez e é válido até{' '}
          <span className="font-mono tabular-nums text-slate-900">{formatDateTimePt(info.expiresAt)}</span>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Definir palavra-passe</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit} noValidate>
            {error && <ErrorBanner title="A palavra-passe não foi definida." message={error} />}
            {otherSession && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Tem sessão iniciada como {otherSession}. Ao continuar, passa a estar com a conta de {info.fullName}.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="set-email">Email</Label>
              <Input id="set-email" type="email" autoComplete="username" value={info.email} readOnly />
            </div>
            <PasswordFields
              idPrefix="set"
              password={password}
              confirmation={confirmation}
              onPasswordChange={setPassword}
              onConfirmationChange={setConfirmation}
              showProblem={tried}
            />
            <Button type="submit" className="w-full" disabled={pending}>
              <KeyRound aria-hidden />
              {pending ? 'A guardar…' : 'Definir palavra-passe e entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
