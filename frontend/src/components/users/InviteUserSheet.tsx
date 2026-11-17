import { useEffect, useState, type FormEvent } from 'react';
import type { CreatedUser } from '@engine/models/api.types';
import type { StaffRole } from '@engine/models/domain';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label, Select } from '@/components/ui/form';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ErrorBanner } from '@/components/ui/states';
import { useCreateUser } from '@/hooks/useUsers';
import { errorMessage } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/formatters';
import { PasswordLinkBox } from './PasswordLinkBox';

interface InviteUserSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** company: utilizador da empresa selecionada. team: conta da equipa P4S (só administradores). */
  scope: 'company' | 'team';
  companyName?: string;
}

export function InviteUserSheet({ open, onOpenChange, scope, companyName }: InviteUserSheetProps) {
  const createUser = useCreateUser();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('consultant');
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setEmail('');
    setRole('consultant');
    setCreated(null);
    setError(null);
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createUser.mutate(
      { fullName: fullName.trim(), email: email.trim(), ...(scope === 'team' ? { role } : {}) },
      { onSuccess: setCreated, onError: (cause) => setError(errorMessage(cause)) },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="invite-description">
        <form className="flex h-full flex-col" onSubmit={submit} noValidate>
          <SheetHeader>
            <SheetTitle>{scope === 'team' ? 'Convidar para a equipa P4S' : 'Convidar utilizador'}</SheetTitle>
            <SheetDescription id="invite-description">
              {scope === 'team'
                ? 'A pessoa passa a poder fazer diagnósticos e configurar propostas.'
                : `A pessoa passa a ver o plano de ${companyName ?? 'a empresa'} e a atualizar o estado das tarefas.`}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {created ? (
              <PasswordLinkBox link={created.passwordLink} fullName={created.user.fullName} />
            ) : (
              <>
                {error && <ErrorBanner title="Não foi possível criar a conta." message={error} />}
                <div className="space-y-1.5">
                  <Label htmlFor="invite-name">Nome</Label>
                  <Input id="invite-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
                  <FieldHint>É com este email que a pessoa entra. Não é enviado nenhum email automático.</FieldHint>
                </div>
                {scope === 'team' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-role">Papel</Label>
                    <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
                      <option value="consultant">{ROLE_LABELS.consultant}</option>
                      <option value="admin">{ROLE_LABELS.admin}</option>
                    </Select>
                    <FieldHint>Só o administrador gere a equipa P4S.</FieldHint>
                  </div>
                )}
              </>
            )}
          </SheetBody>

          <SheetFooter>
            <span />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={createUser.isPending}>
                {created ? 'Fechar' : 'Cancelar'}
              </Button>
              {!created && (
                <Button type="submit" size="sm" disabled={createUser.isPending || fullName.trim().length < 2 || !email.includes('@')}>
                  {createUser.isPending ? 'A criar…' : 'Criar conta e gerar link'}
                </Button>
              )}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
