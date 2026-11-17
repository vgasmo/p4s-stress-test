import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ErrorBanner } from '@/components/ui/states';
import { api, errorMessage } from '@/lib/api';
import { sessionStore } from '@/lib/session';
import { PasswordFields, passwordProblem } from './PasswordFields';

interface ChangePasswordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordSheet({ open, onOpenChange }: ChangePasswordSheetProps) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setPassword('');
    setConfirmation('');
    setTried(false);
    setError(null);
    setDone(false);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError(null);
    if (!current || passwordProblem(password, confirmation)) return;
    setPending(true);
    try {
      // A API devolve uma sessão nova: as anteriores deixam de poder ser renovadas.
      sessionStore.set(await api.changePassword(current, password));
      setDone(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="change-password-description">
        <form className="flex h-full flex-col" onSubmit={submit} noValidate>
          <SheetHeader>
            <SheetTitle>Alterar palavra-passe</SheetTitle>
            <SheetDescription id="change-password-description">
              As sessões abertas noutros dispositivos terminam de imediato.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {done ? (
              <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-900">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                <p className="text-sm">Palavra-passe alterada. Continua com sessão iniciada neste dispositivo.</p>
              </div>
            ) : (
              <>
                {error && <ErrorBanner title="A palavra-passe não foi alterada." message={error} />}
                <div className="space-y-1.5">
                  <Label htmlFor="current-password">Palavra-passe atual</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    aria-invalid={tried && !current ? true : undefined}
                    onChange={(event) => setCurrent(event.target.value)}
                    autoFocus
                  />
                </div>
                <PasswordFields
                  idPrefix="change"
                  password={password}
                  confirmation={confirmation}
                  onPasswordChange={setPassword}
                  onConfirmationChange={setConfirmation}
                  showProblem={tried}
                />
              </>
            )}
          </SheetBody>
          <SheetFooter>
            <span />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
                {done ? 'Fechar' : 'Cancelar'}
              </Button>
              {!done && (
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'A guardar…' : 'Alterar palavra-passe'}
                </Button>
              )}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
