import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form';
import { ErrorBanner } from '@/components/ui/states';
import { useAuthActions } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';
import { useSession } from '@/lib/session';

export function LoginPage() {
  const session = useSession();
  const { login } = useAuthActions();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'), window.location.origin);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to={next} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="max-w-xl">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">Área reservada</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Diagnóstico, plano de ação e proposta</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          A simulação é livre. A equipa P4S entra para gravar o diagnóstico e fechar a proposta. As empresas clientes entram
          para acompanhar o plano de ação e exportar o resumo executivo.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Entrar</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit} noValidate>
            {error && <ErrorBanner title="Não foi possível entrar." message={error} />}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Palavra-passe</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending || !email || !password}>
              <LogIn aria-hidden />
              {pending ? 'A entrar…' : 'Entrar'}
            </Button>
            <p className="text-xs text-slate-600">
              Esqueceu-se da palavra-passe ou ainda não tem conta? Peça um link de acesso ao seu consultor Plan4Sustain.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
