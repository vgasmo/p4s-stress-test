import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthActions, useCompanies } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Equipa P4S: escolhe a empresa cliente da sessão (o token passa a ter esse companyId). */
export function CompanySwitcher() {
  const session = useSession();
  const companies = useCompanies();
  const { switchCompany } = useAuthActions();
  const navigate = useNavigate();
  // Empresa escolhida enquanto a sessão muda (undefined: nenhuma troca em curso).
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const switching = pending !== undefined;

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

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="company-switcher" className="sr-only">
        Empresa cliente
      </label>
      <Select
        id="company-switcher"
        containerClassName="w-44 sm:w-60"
        className="h-8 text-xs"
        value={(switching ? pending : session?.companyId) ?? ''}
        disabled={switching}
        title={error ?? undefined}
        aria-invalid={error ? true : undefined}
        onChange={async (event) => {
          // Lido antes do pedido: depois do await o campo já pode ter outro valor.
          const companyId = event.target.value || null;
          setPending(companyId);
          setError(null);
          try {
            await switchCompany(companyId);
            navigate(companyId ? '/plano' : '/');
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setPending(undefined);
          }
        }}
      >
        <option value="">Sem empresa (nova reunião)</option>
        {companies.data.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name} · {company.nif}
          </option>
        ))}
      </Select>
    </div>
  );
}
