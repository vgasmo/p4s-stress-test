// Corrigir os dados da empresa selecionada (equipa P4S): um nome mal escrito na reunião
// aparece no cabeçalho do plano e na linha «Aceite por» do resumo impresso.

import { useEffect, useState, type FormEvent } from 'react';
import type { CompanySummary } from '@engine/models/api.types';
import { SECTOR_PROFILES, type SectorProfile } from '@engine/models/domain';
import type { UpdateCompanyInput } from '@engine/models/schemas';
import { isValidCae, isValidNif } from '@engine/utils/validation';
import { Button } from '@/components/ui/button';
import { EuroInput } from '@/components/ui/euro-input';
import { FieldError, FieldHint, Input, Label, Select } from '@/components/ui/form';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ErrorBanner } from '@/components/ui/states';
import { useUpdateCompany } from '@/hooks/useAssessment';
import { errorMessage } from '@/lib/api';
import { SECTOR_PROFILE_LABELS } from '@/lib/formatters';

interface CompanySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: CompanySummary;
}

interface FormState {
  name: string;
  nif: string;
  cae: string;
  sectorProfile: SectorProfile;
  annualRevenue: number;
  exportPercentage: string;
}

const fromCompany = (company: CompanySummary): FormState => ({
  name: company.name,
  nif: company.nif,
  cae: company.cae,
  sectorProfile: company.sectorProfile,
  annualRevenue: company.annualRevenue,
  exportPercentage: String(company.exportPercentage),
});

export function CompanySheet({ open, onOpenChange, company }: CompanySheetProps) {
  const update = useUpdateCompany(company.id);
  const [form, setForm] = useState<FormState>(() => fromCompany(company));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(fromCompany(company));
    setTried(false);
    setError(null);
    // Os dados são lidos ao abrir: uma atualização em segundo plano não apaga o que está a ser escrito.
  }, [open, company.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const close = () => onOpenChange(false);

  const exportPercentage = Number(form.exportPercentage.replace(',', '.'));
  const problems = {
    name: form.name.trim().length < 2 ? 'Indique o nome da empresa.' : null,
    nif: isValidNif(form.nif.trim()) ? null : 'NIF inválido (9 dígitos com dígito de controlo).',
    // Uma empresa registada à pressa pode ainda não ter CAE: fica vazio até ser preenchido.
    cae: form.cae.trim() === '' || isValidCae(form.cae.trim()) ? null : 'CAE inválido (5 dígitos).',
    exportPercentage:
      form.exportPercentage.trim() !== '' && exportPercentage >= 0 && exportPercentage <= 100 ? null : 'Entre 0 e 100.',
  };
  const invalid = Object.values(problems).some(Boolean);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError(null);
    if (invalid) return;

    const patch: UpdateCompanyInput = {};
    if (form.name.trim() !== company.name) patch.name = form.name.trim();
    if (form.nif.trim() !== company.nif) patch.nif = form.nif.trim();
    if (form.cae.trim() !== company.cae && form.cae.trim() !== '') patch.cae = form.cae.trim();
    if (form.sectorProfile !== company.sectorProfile) patch.sectorProfile = form.sectorProfile;
    if (form.annualRevenue !== company.annualRevenue) patch.annualRevenue = form.annualRevenue;
    if (exportPercentage !== company.exportPercentage) patch.exportPercentage = exportPercentage;
    if (Object.keys(patch).length === 0) return close();

    update.mutate(patch, { onSuccess: close, onError: (cause) => setError(errorMessage(cause)) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="company-sheet-description">
        <form className="flex h-full flex-col" onSubmit={submit} noValidate>
          <SheetHeader>
            <SheetTitle>Dados da empresa</SheetTitle>
            <SheetDescription id="company-sheet-description">
              O nome e o NIF aparecem no plano e no resumo impresso. O setor e a faturação servem de ponto de partida para o
              próximo diagnóstico: os diagnósticos já gravados não mudam.
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error && <ErrorBanner title="Os dados não foram guardados." message={error} />}

            <div className="space-y-1.5">
              <Label htmlFor="company-edit-name">Nome</Label>
              <Input
                id="company-edit-name"
                value={form.name}
                maxLength={255}
                aria-invalid={tried && problems.name ? true : undefined}
                onChange={(event) => set('name', event.target.value)}
              />
              {tried && problems.name && <FieldError>{problems.name}</FieldError>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="company-edit-nif">NIF</Label>
                <Input
                  id="company-edit-nif"
                  inputMode="numeric"
                  maxLength={9}
                  className="font-mono tabular-nums"
                  value={form.nif}
                  aria-invalid={tried && problems.nif ? true : undefined}
                  onChange={(event) => set('nif', event.target.value.replace(/\D/g, ''))}
                />
                {tried && problems.nif && <FieldError>{problems.nif}</FieldError>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-edit-cae">CAE</Label>
                <Input
                  id="company-edit-cae"
                  inputMode="numeric"
                  maxLength={5}
                  className="font-mono tabular-nums"
                  value={form.cae}
                  placeholder="5 dígitos"
                  aria-invalid={tried && problems.cae ? true : undefined}
                  onChange={(event) => set('cae', event.target.value.replace(/\D/g, ''))}
                />
                {tried && problems.cae && <FieldError>{problems.cae}</FieldError>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company-edit-sector">Perfil setorial</Label>
              <Select
                id="company-edit-sector"
                value={form.sectorProfile}
                onChange={(event) => set('sectorProfile', event.target.value as SectorProfile)}
              >
                {SECTOR_PROFILES.map((sector) => (
                  <option key={sector} value={sector}>
                    {SECTOR_PROFILE_LABELS[sector]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="company-edit-revenue">Faturação anual</Label>
                <EuroInput
                  id="company-edit-revenue"
                  value={form.annualRevenue}
                  onValueChange={(annualRevenue) => set('annualRevenue', annualRevenue)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-edit-export">Exportação (%)</Label>
                <Input
                  id="company-edit-export"
                  inputMode="decimal"
                  className="font-mono tabular-nums"
                  value={form.exportPercentage}
                  aria-invalid={tried && problems.exportPercentage ? true : undefined}
                  onChange={(event) => set('exportPercentage', event.target.value.replace(/[^\d.,]/g, ''))}
                />
                {tried && problems.exportPercentage && <FieldError>{problems.exportPercentage}</FieldError>}
              </div>
            </div>
            <FieldHint>Para mudar o setor ou a faturação de um diagnóstico já gravado, faça um novo diagnóstico.</FieldHint>
          </SheetBody>

          <SheetFooter>
            <span />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={close} disabled={update.isPending}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={update.isPending}>
                {update.isPending ? 'A guardar…' : 'Guardar alterações'}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
