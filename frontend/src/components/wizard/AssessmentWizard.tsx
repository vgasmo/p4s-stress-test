import { ArrowRight, Building2, LogIn } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SECTOR_PROFILES, type SectorProfile } from '@engine/models/domain';
import {
  REQUIREMENT_CATALOG,
  SECTOR_DEALBREAKERS,
  SPREAD_PENALTY_BPS,
  describeSources,
  type RequirementCode,
  type StressTestInput,
} from '@engine/services/requirements.catalog';
import { isValidNif } from '@engine/utils/validation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EuroInput } from '@/components/ui/euro-input';
import { FieldError, FieldHint, Input, Label } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { ErrorBanner } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { useMe } from '@/hooks/useAuth';
import { useCreateAssessment, useStressTestPreview } from '@/hooks/useAssessment';
import { errorMessage, type CreateAssessmentPayload } from '@/lib/api';
import {
  SECTOR_PROFILE_LABELS,
  formatCompactEUR,
  formatEUR,
  formatNumberPt,
  formatWeight,
} from '@/lib/formatters';
import { isStaffSession, useSession } from '@/lib/session';
import { cn, readStorage, writeStorage } from '@/lib/utils';
import { LiveImpactPreview } from './LiveImpactPreview';

type RequirementField = 'ecovadis' | 'carbonFootprintScope12' | 'carbonFootprintScope3' | 'bankingEsgMetrics' | 'tisaxOrNis2';

export interface WizardState extends Record<RequirementField, boolean> {
  companyName: string;
  companyNif: string;
  sectorProfile: SectorProfile;
  annualRevenue: number;
  topClientsShare: number;
  hasRefinancing: boolean;
  creditLineToRefinance: number;
  /** Empresa a que este rascunho pertence (null: simulação sem empresa). */
  prefilledFor: string | null;
  /** O utilizador já mexeu em algum controlo. */
  touched: boolean;
}

const DRAFT_KEY = 'p4s.wizard-draft';

const DEFAULT_STATE: WizardState = {
  companyName: '',
  companyNif: '',
  sectorProfile: 'general_industrial',
  annualRevenue: 5_000_000,
  topClientsShare: 60,
  hasRefinancing: false,
  creditLineToRefinance: 2_000_000,
  ecovadis: false,
  carbonFootprintScope12: false,
  carbonFootprintScope3: false,
  bankingEsgMetrics: false,
  tisaxOrNis2: false,
  prefilledFor: null,
  touched: false,
};

const REQUIREMENT_FIELDS: Record<RequirementCode, RequirementField> = {
  ecovadis: 'ecovadis',
  carbon_scope_1_2: 'carbonFootprintScope12',
  carbon_scope_3: 'carbonFootprintScope3',
  banking_esg: 'bankingEsgMetrics',
  information_security: 'tisaxOrNis2',
};

const REVENUE_PRESETS = [2_000_000, 5_000_000, 10_000_000, 25_000_000];
const CREDIT_PRESETS = [1_000_000, 2_500_000, 5_000_000];

export function toStressTestInput(state: WizardState): StressTestInput {
  return {
    sectorProfile: state.sectorProfile,
    annualRevenue: state.annualRevenue,
    topClientsShare: state.topClientsShare,
    creditLineToRefinance: state.hasRefinancing ? state.creditLineToRefinance : 0,
    ecovadis: state.ecovadis,
    carbonFootprintScope12: state.carbonFootprintScope12,
    carbonFootprintScope3: state.carbonFootprintScope3,
    bankingEsgMetrics: state.bankingEsgMetrics,
    tisaxOrNis2: state.tisaxOrNis2,
  };
}

function useWizardDraft() {
  const [state, setState] = useState<WizardState>(() => ({
    ...DEFAULT_STATE,
    ...(readStorage<Partial<WizardState>>('session', DRAFT_KEY) ?? {}),
  }));
  useEffect(() => writeStorage('session', DRAFT_KEY, state), [state]);
  /** Alteração feita pelo utilizador. */
  const update = (patch: Partial<WizardState>) => setState((current) => ({ ...current, ...patch, touched: true }));
  const reset = () => {
    writeStorage('session', DRAFT_KEY, null);
    setState(DEFAULT_STATE);
  };
  return { state, setState, update, reset };
}

export function AssessmentWizard() {
  const session = useSession();
  const staff = isStaffSession(session);
  const me = useMe();
  const navigate = useNavigate();
  const createAssessment = useCreateAssessment();
  const { state, setState, update, reset } = useWizardDraft();
  const [newCompany, setNewCompany] = useState(false);
  const [triedSave, setTriedSave] = useState(false);

  const company = me.data?.company ?? null;
  // Empresa da sessão: undefined enquanto carrega, null sem sessão ou sem empresa selecionada.
  const sessionCompanyId = !session ? null : me.isSuccess ? (company?.id ?? null) : undefined;

  // O rascunho pertence a uma empresa. Quando a empresa da sessão muda:
  //  - simulação feita antes de entrar ou de escolher a empresa: mantém o que foi introduzido;
  //  - troca entre empresas: começa de novo com o setor e a faturação da nova empresa;
  //  - saída da empresa ou fim de sessão: limpa, para não mostrar dados de um cliente a outro.
  useEffect(() => {
    if (sessionCompanyId === undefined || sessionCompanyId === state.prefilledFor) return;
    if (sessionCompanyId === null || !company) {
      reset();
    } else if (state.prefilledFor === null && state.touched) {
      setState((current) => ({ ...current, prefilledFor: company.id }));
    } else {
      setState({
        ...DEFAULT_STATE,
        prefilledFor: company.id,
        sectorProfile: company.sectorProfile,
        ...(company.annualRevenue > 0 ? { annualRevenue: company.annualRevenue } : {}),
      });
    }
    // Só reage à mudança de empresa; o estado é lido no momento.
  }, [sessionCompanyId]);

  const input = useMemo(() => toStressTestInput(state), [state]);
  const preview = useStressTestPreview(input);

  if (session && me.isPending) return <WizardSkeleton />;
  if (session && me.isError) {
    return (
      <ErrorBanner
        title="Não foi possível carregar a sessão."
        message={errorMessage(me.error)}
        onRetry={() => void me.refetch()}
        retrying={me.isFetching}
      />
    );
  }

  const quickCreate = staff && (!company || newCompany);
  const nifValid = isValidNif(state.companyNif.trim());
  const nameValid = state.companyName.trim().length >= 2;
  const canSave = Boolean(session) && (!quickCreate || (nifValid && nameValid)) && state.annualRevenue > 0;

  const save = () => {
    setTriedSave(true);
    if (!canSave) return;
    const payload: CreateAssessmentPayload = {
      ...toStressTestInput(state),
      ...(quickCreate ? { company: { name: state.companyName.trim(), nif: state.companyNif.trim() } } : {}),
    };
    createAssessment.mutate(payload, {
      onSuccess: (detail) => {
        reset();
        navigate(`/plano/${detail.id}`);
      },
    });
  };

  const dealbreaker = SECTOR_DEALBREAKERS.find((rule) => rule.sector === state.sectorProfile);
  const evaluations = 'result' in preview ? preview.result.evaluations : [];

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4">
        <CompanyBlock
          session={Boolean(session)}
          staff={staff}
          companyName={company?.name ?? null}
          companyNif={company?.nif ?? null}
          quickCreate={quickCreate}
          canToggleNew={staff && Boolean(company)}
          onToggleNew={setNewCompany}
          state={state}
          update={update}
          showErrors={triedSave}
          nifValid={nifValid}
          nameValid={nameValid}
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>1 · Perfil e base exposta</CardTitle>
              <CardDescription>O setor muda os pesos e os pisos de bloqueio. A base exposta é a faturação nos 3 maiores clientes.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-slate-700">Perfil setorial</legend>
              <div role="radiogroup" aria-label="Perfil setorial" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                {SECTOR_PROFILES.map((sector) => {
                  const checked = state.sectorProfile === sector;
                  return (
                    <button
                      key={sector}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => update({ sectorProfile: sector })}
                      className={cn(
                        'rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
                        checked
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50',
                      )}
                    >
                      {SECTOR_PROFILE_LABELS[sector]}
                    </button>
                  );
                })}
              </div>
              <FieldHint>
                {dealbreaker
                  ? `Piso de bloqueio: sem ${dealbreaker.triggers
                      .map((code) => REQUIREMENT_CATALOG.find((rule) => rule.code === code)?.label)
                      .join(' ou ')}, o peso comercial nunca fica abaixo de ${formatNumberPt(dealbreaker.floorPoints / 100, 2)}.`
                  : 'Sem piso de bloqueio neste setor. Contam só os pesos das lacunas.'}
              </FieldHint>
            </fieldset>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="annual-revenue">Faturação anual</Label>
                <EuroInput id="annual-revenue" value={state.annualRevenue} onValueChange={(annualRevenue) => update({ annualRevenue })} />
                <Presets values={REVENUE_PRESETS} current={state.annualRevenue} onPick={(annualRevenue) => update({ annualRevenue })} label="Faturação" />
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label id="share-label">Concentração nos 3 maiores clientes</Label>
                  <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">{state.topClientsShare}%</span>
                </div>
                <Slider
                  aria-labelledby="share-label"
                  min={10}
                  max={100}
                  step={1}
                  value={[state.topClientsShare]}
                  onValueChange={([value]) => value !== undefined && update({ topClientsShare: value })}
                />
                <FieldHint>
                  Base exposta:{' '}
                  <span className="font-mono tabular-nums text-slate-900">
                    {formatEUR(Math.round((state.annualRevenue * state.topClientsShare) / 100))}
                  </span>
                </FieldHint>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>2 · Banca</CardTitle>
              <CardDescription>Risco financeiro, separado da faturação. Sem rácios ESG, o refinanciamento agrava o spread em {SPREAD_PENALTY_BPS} bps/ano.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              id="has-refinancing"
              title="Refinanciamento bancário nos próximos 18 meses"
              description="Linhas de crédito ou financiamentos a renovar."
              checked={state.hasRefinancing}
              onChange={(hasRefinancing) => update({ hasRefinancing })}
            />
            {state.hasRefinancing && (
              <div className="grid grid-cols-1 gap-2 border-l-2 border-slate-200 pl-4 md:max-w-md">
                <Label htmlFor="credit-line">Montante a refinanciar</Label>
                <EuroInput
                  id="credit-line"
                  value={state.creditLineToRefinance}
                  onValueChange={(creditLineToRefinance) => update({ creditLineToRefinance })}
                />
                <Presets values={CREDIT_PRESETS} current={state.creditLineToRefinance} onPick={(creditLineToRefinance) => update({ creditLineToRefinance })} label="Crédito" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>3 · O que a fábrica já tem</CardTitle>
              <CardDescription>Ligue o que já existe e está atualizado. Cada lacuna gera uma tarefa com preço e prazo fechados.</CardDescription>
            </div>
          </CardHeader>
          <ul className="divide-y divide-slate-200">
            {REQUIREMENT_CATALOG.map((rule) => {
              const field = REQUIREMENT_FIELDS[rule.code];
              const evaluation = evaluations.find((e) => e.rule.code === rule.code);
              const notApplicable = evaluation?.status === 'not_applicable';
              const impact =
                rule.channel === 'financial'
                  ? `${SPREAD_PENALTY_BPS} bps/ano sobre o crédito`
                  : `${formatWeight(evaluation?.weightPoints ?? 0)} na exposição`;
              return (
                <li key={rule.code} className={cn('flex items-center gap-4 px-4 py-3', notApplicable && 'bg-slate-50')}>
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`req-${rule.code}`} className="text-sm font-medium text-slate-900">
                      {rule.label}
                    </label>
                    <p className="text-xs text-slate-600">
                      Exigido por {describeSources(rule.requiredBy)}
                      {notApplicable ? ' · só conta com refinanciamento a <18 meses' : ''}
                    </p>
                  </div>
                  <span className="hidden font-mono text-xs tabular-nums text-slate-700 sm:block">{impact}</span>
                  <StatusPill status={evaluation?.status} />
                  <Switch
                    id={`req-${rule.code}`}
                    checked={state[field]}
                    onCheckedChange={(checked) => update({ [field]: checked } as Partial<WizardState>)}
                    aria-label={`${rule.label}: ${state[field] ? 'tem' : 'não tem'}`}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <LiveImpactPreview
        preview={preview}
        annualRevenue={state.annualRevenue}
        creditLineToRefinance={input.creditLineToRefinance}
        onUseSampleRevenue={() => update({ annualRevenue: 5_000_000 })}
        saveArea={
          <SaveArea
            session={Boolean(session)}
            canSave={canSave}
            triedSave={triedSave}
            saving={createAssessment.isPending}
            error={createAssessment.isError ? errorMessage(createAssessment.error) : null}
            onSave={save}
          />
        }
      />
    </div>
  );
}

function SaveArea({
  session,
  canSave,
  triedSave,
  saving,
  error,
  onSave,
}: {
  session: boolean;
  canSave: boolean;
  triedSave: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  if (!session) {
    return (
      <div className="space-y-2">
        <Button asChild className="w-full">
          <Link to="/entrar?next=/">
            <LogIn aria-hidden /> Entrar para guardar e gerar o plano
          </Link>
        </Button>
        <p className="text-2xs text-slate-600">As respostas ficam neste separador até entrar.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error && <ErrorBanner title="O diagnóstico não foi guardado." message={error} onRetry={onSave} retrying={saving} />}
      <Button className="w-full" onClick={onSave} disabled={saving}>
        {saving ? 'A guardar…' : 'Guardar Diagnóstico e Gerar Plano de Ação'}
        {!saving && <ArrowRight aria-hidden />}
      </Button>
      {triedSave && !canSave && <FieldError>Complete os dados da empresa e a faturação antes de guardar.</FieldError>}
    </div>
  );
}

function CompanyBlock({
  session,
  staff,
  companyName,
  companyNif,
  quickCreate,
  canToggleNew,
  onToggleNew,
  state,
  update,
  showErrors,
  nifValid,
  nameValid,
}: {
  session: boolean;
  staff: boolean;
  companyName: string | null;
  companyNif: string | null;
  quickCreate: boolean;
  canToggleNew: boolean;
  onToggleNew: (value: boolean) => void;
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  showErrors: boolean;
  nifValid: boolean;
  nameValid: boolean;
}) {
  if (!session) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <Badge tone="dark">Modo reunião</Badge>
        <p className="text-sm text-slate-700">Simulação sem registo. Os números são os mesmos que ficam gravados no diagnóstico.</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="items-center">
        <div className="flex items-center gap-2">
          <Building2 aria-hidden className="size-4 text-slate-600" />
          <CardTitle>Empresa</CardTitle>
        </div>
        {canToggleNew && (
          <label className="flex items-center gap-2 text-xs text-slate-700">
            Nova empresa
            <Switch checked={quickCreate} onCheckedChange={onToggleNew} aria-label="Registar nova empresa" />
          </label>
        )}
      </CardHeader>
      <CardContent>
        {quickCreate ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Nome</Label>
              <Input
                id="company-name"
                value={state.companyName}
                placeholder="Ex.: Moldes Exemplo, Lda"
                aria-invalid={showErrors && !nameValid ? true : undefined}
                onChange={(event) => update({ companyName: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-nif">NIF</Label>
              <Input
                id="company-nif"
                inputMode="numeric"
                maxLength={9}
                className="font-mono tabular-nums"
                value={state.companyNif}
                aria-invalid={showErrors && !nifValid ? true : undefined}
                onChange={(event) => update({ companyNif: event.target.value.replace(/\D/g, '') })}
              />
            </div>
            {showErrors && (!nameValid || !nifValid) && (
              <FieldError className="md:col-span-2">
                {!nifValid ? 'NIF inválido (9 dígitos com dígito de controlo).' : 'Indique o nome da empresa.'}
              </FieldError>
            )}
            <FieldHint className="md:col-span-2">
              {staff ? 'Se o NIF já existir, o diagnóstico fica associado a essa empresa.' : ''}
            </FieldHint>
          </div>
        ) : (
          <p className="text-sm text-slate-900">
            <span className="font-medium">{companyName}</span>{' '}
            <span className="font-mono text-xs tabular-nums text-slate-600">NIF {companyNif}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-900">
          {title}
        </label>
        <p className="text-xs text-slate-600">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Presets({
  values,
  current,
  onPick,
  label,
}: {
  values: number[];
  current: number;
  onPick: (value: number) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${label}: valores rápidos`}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onPick(value)}
          aria-pressed={current === value}
          className={cn(
            'h-7 rounded-md border px-2.5 font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
            current === value
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50',
          )}
        >
          {formatCompactEUR(value)}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: 'compliant' | 'gap' | 'not_applicable' | undefined }): ReactNode {
  if (status === 'gap') return <Badge tone="critical">Lacuna</Badge>;
  if (status === 'compliant') return <Badge tone="success">Conforme</Badge>;
  return <Badge tone="outline">N/A</Badge>;
}

function WizardSkeleton() {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]" aria-busy="true" aria-label="A carregar">
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <Skeleton className="h-4 w-48" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-1.5 w-full" />
        <div className="grid grid-cols-3 gap-3 pt-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}
