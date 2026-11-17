import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthActions, useCompanies } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { HeaderNotice } from './HeaderNotices';
import { Notice } from './Notice';

/** Troca de empresa que falhou: fica à vista, com o motivo, até ser repetida ou fechada. */
interface FailedSwitch {
  companyId: string | null;
  message: string;
}

/** Equipa P4S: escolhe a empresa cliente da sessão (o token passa a ter esse companyId). */
export function CompanySwitcher() {
  const session = useSession();
  const companies = useCompanies();
  const { switchCompany } = useAuthActions();
  const navigate = useNavigate();
  const select = useRef<HTMLSelectElement>(null);
  // Empresa escolhida enquanto a sessão muda (undefined: nenhuma troca em curso).
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [failure, setFailure] = useState<FailedSwitch | null>(null);
  const switching = pending !== undefined;

  // Durante a troca o seletor fica desativado e o browser tira-lhe o foco. O aviso, ao sair do
  // ecrã, leva o botão que o tinha. Nos dois casos o foco volta ao seletor quando ele fica ativo,
  // a não ser que entretanto tenha ido para outro lado.
  const [returnFocus, setReturnFocus] = useState(false);
  useEffect(() => {
    if (!returnFocus || switching) return;
    const active = document.activeElement;
    if (!active || active === document.body) select.current?.focus();
    setReturnFocus(false);
  }, [returnFocus, switching]);

  if (companies.isPending) return <Skeleton className="h-8 w-56" />;
  if (companies.isError) {
    return (
      <button
        type="button"
        onClick={() => void companies.refetch()}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-900 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700"
      >
        <RotateCcw aria-hidden className="size-3.5" /> Empresas indisponíveis. Tentar novamente
      </button>
    );
  }

  const change = async (companyId: string | null) => {
    const hadFocus = document.activeElement === select.current;
    setPending(companyId);
    // O aviso de uma troca anterior só fica se for essa mesma troca a ser repetida.
    setFailure((current) => (current?.companyId === companyId ? current : null));
    try {
      await switchCompany(companyId);
      setFailure(null);
      setReturnFocus(true);
      navigate(companyId ? '/plano' : '/');
    } catch (cause) {
      setFailure({ companyId, message: errorMessage(cause) });
      if (hadFocus) setReturnFocus(true);
    } finally {
      setPending(undefined);
    }
  };

  const failedName = failure?.companyId ? companies.data.find((company) => company.id === failure.companyId)?.name : null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="company-switcher" className="sr-only">
        Empresa cliente
      </label>
      <Select
        ref={select}
        id="company-switcher"
        containerClassName="w-44 sm:w-60"
        className="h-8 text-xs"
        value={(switching ? pending : session?.companyId) ?? ''}
        disabled={switching}
        aria-invalid={failure ? true : undefined}
        onChange={(event) => void change(event.target.value || null)}
      >
        <option value="">Sem empresa (nova reunião)</option>
        {companies.data.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name} · {company.nif}
          </option>
        ))}
      </Select>
      {failure && (
        <HeaderNotice>
          <Notice
            title={
              failure.companyId
                ? `Não foi possível mudar para ${failedName ?? 'a empresa escolhida'}.`
                : 'Não foi possível sair da empresa selecionada.'
            }
            onRetry={() => void change(failure.companyId)}
            retrying={switching}
            onDismiss={() => {
              setFailure(null);
              setReturnFocus(true);
            }}
            testId="company-switch-error"
          >
            <p className="text-xs text-rose-800">{failure.message}</p>
          </Notice>
        </HeaderNotice>
      )}
    </div>
  );
}
