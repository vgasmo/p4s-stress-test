import { ArrowRight, Building2, ClipboardList, LogIn, Mail, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SECTOR_PROFILES } from '@engine/models/domain';
import { REQUIREMENTS, describeSources, forSector, requirementStatus } from '@engine/services/requirements';
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
import { useCompanies, useMe } from '@/hooks/useAuth';
import { useCatalog, useCreateAssessment, usePublicSimulation, useStressTestPreview } from '@/hooks/useAssessment';
import { useContactEmail } from '@/hooks/usePublicInfo';
import { errorMessage, type CreateAssessmentPayload } from '@/lib/api';
import { diagnosisRequestMailto } from '@/lib/contact';
import {
  SECTOR_PROFILE_LABELS,
  formatCompactEUR,
  formatEUR,
  formatEuroRange,
  formatNumberPt,
  formatWeight,
} from '@/lib/formatters';
import { isStaffSession, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { PlanNavigationState } from '@/pages/ActionPlanPage';
import { LiveImpactPreview } from './LiveImpactPreview';
import { PreviousDiagnosisOffer } from './PreviousDiagnosisOffer';
import { applyPreviousAnswers, type PreviousAnswers } from './previous-answers';
import { RadioTiles } from './RadioTiles';
import { useAppHeaderHeight, useElementHeight } from './useElementHeight';
import {
  DEFAULT_STATE,
  applyToSessionCompany,
  clearWizardDrafts,
  freshDraft,
  loadDraft,
  loadSetAside,
  newCompanyDraft,
  reconcileDraft,
  resumeAsNewCompany,
  saveDraft,
  saveSetAside,
  toStressTestInput,
  type DraftContext,
  type WizardState,
} from './wizard-draft';

/** anonymous: visitante. company: conta de uma empresa (só simula). staff: equipa P4S (grava). */
type WizardMode = 'anonymous' | 'company' | 'staff';

const SECTOR_OPTIONS = SECTOR_PROFILES.map((sector) => ({ value: sector, label: SECTOR_PROFILE_LABELS[sector] }));
const REVENUE_PRESETS = [2_000_000, 5_000_000, 10_000_000, 25_000_000];
const CREDIT_PRESETS = [1_000_000, 2_500_000, 5_000_000];

/**
 * Rascunho do wizard, guardado no separador e acertado com a sessão: ver wizard-draft.ts.
 * ctx fica undefined enquanto a sessão carrega, para não decidir nada com dados a meio.
 */
function useWizardDraft(ctx: DraftContext | undefined) {
  const [state, setState] = useState<WizardState>(loadDraft);
  const [setAside, setSetAside] = useState<WizardState | null>(loadSetAside);
  // Conta as vezes em que as respostas foram trocadas de uma só vez (recomeçar, outra empresa,
  // simulação que estava de parte): os campos largam o texto que tinham a meio.
  const [revision, setRevision] = useState(0);
  const replace = (next: WizardState) => {
    setState(next);
    setRevision((current) => current + 1);
  };
  useEffect(() => saveDraft(state), [state]);
  useEffect(() => saveSetAside(setAside), [setAside]);

  // Mudou a pessoa ou a empresa selecionada: o rascunho é acertado antes de o ecrã ser
  // desenhado, para nunca mostrar as respostas de um cliente sob o nome de outro.
  const contextKey = ctx ? `${ctx.userId ?? ''}|${ctx.staff}|${ctx.company?.id ?? ''}` : undefined;
  const [reconciledFor, setReconciledFor] = useState<string | undefined>(undefined);
  if (ctx && contextKey !== reconciledFor) {
    const next = reconcileDraft(state, ctx);
    setReconciledFor(contextKey);
    if (next.draft !== state) replace(next.draft);
    if (next.setAside) setSetAside(next.setAside);
  }

  return {
    state,
    setAside,
    revision,
    /** Alteração feita pelo utilizador. */
    update: (patch: Partial<WizardState>) => setState((current) => ({ ...current, ...patch, touched: true })),
    /** Respostas de um diagnóstico anterior, pedidas pelo consultor. */
    applyAnswers: (answers: PreviousAnswers) => setState((current) => applyPreviousAnswers(current, answers)),
    /** Liga ou desliga o registo de uma empresa nova: em ambos os casos começa com o formulário limpo. */
    setNewCompany: (on: boolean) => ctx && replace(on ? newCompanyDraft(ctx) : freshDraft(ctx)),
    restart: () => ctx && replace(state.newCompany ? newCompanyDraft(ctx) : freshDraft(ctx)),
    applySetAside: () => {
      if (!ctx || !setAside) return;
      replace(applyToSessionCompany(setAside, ctx));
      setSetAside(null);
    },
    resumeSetAside: () => {
      if (!ctx || !setAside) return;
      replace(resumeAsNewCompany(setAside, ctx));
      setSetAside(null);
    },
    discardSetAside: () => setSetAside(null),
    /** Depois de gravar: nada fica no separador. */
    clear: () => {
      clearWizardDrafts();
      setSetAside(null);
      replace({ ...DEFAULT_STATE, owner: ctx?.userId ?? null });
    },
  };
}

export function AssessmentWizard() {
  const session = useSession();
  const staff = isStaffSession(session);
  const me = useMe();
  const companies = useCompanies();
  const navigate = useNavigate();
  const createAssessment = useCreateAssessment();
  const [triedSave, setTriedSave] = useState(false);
  // Campos em euros com texto que não foi percebido: o valor em vigor é o anterior, por isso
  // não se grava enquanto lá estiver.
  const [unread, setUnread] = useState({ revenue: false, credit: false });
  // Um botão rápido repõe o campo, mesmo que o valor escolhido seja o que já lá estava.
  const [picks, setPicks] = useState({ revenue: 0, credit: 0 });
  const headerHeight = useAppHeaderHeight();
  const [pinnedRef, pinnedHeight] = useElementHeight<HTMLDivElement>();

  const company = me.data?.company ?? null;
  const ctx: DraftContext | undefined =
    session && !me.isSuccess
      ? undefined
      : {
          userId: session?.user.id ?? null,
          staff,
          company: company ? { id: company.id, sectorProfile: company.sectorProfile, annualRevenue: company.annualRevenue } : null,
        };
  const draft = useWizardDraft(ctx);
  const { state, update } = draft;

  const mode: WizardMode = !session ? 'anonymous' : staff ? 'staff' : 'company';
  const input = useMemo(() => toStressTestInput(state), [state]);
  // A equipa P4S calcula aqui, com o catálogo que vem da API. Os outros (visitantes e contas
  // de empresas) recebem do servidor só ordens de grandeza: os pesos e os preços não estão
  // no código público nem saem para clientes.
  const catalog = useCatalog();
  const preview = useStressTestPreview(input, catalog.data);
  const publicSimulation = usePublicSimulation(input, !staff && state.annualRevenue > 0);
  const contact = useContactEmail();

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

  const quickCreate = staff && (!company || state.newCompany);
  const typedNif = state.companyNif.trim();
  const typedName = state.companyName.trim();
  const nifValid = isValidNif(typedNif);
  const nameValid = typedName.length >= 2;
  // Refinanciamento ligado sem montante: para o cálculo é como se não houvesse refinanciamento,
  // por isso o ecrã pede o montante em vez de dar a banca como não aplicável.
  const creditMissing = state.hasRefinancing && state.creditLineToRefinance <= 0;
  // O que falta para gravar, dito junto ao botão. Uma coisa de cada vez, pela ordem do ecrã.
  const saveBlocker = !staff
    ? null
    : quickCreate && !(nifValid && nameValid)
      ? 'Complete o nome e o NIF da empresa antes de guardar.'
      : unread.revenue || unread.credit
        ? 'Corrija o valor assinalado antes de guardar.'
        : state.annualRevenue <= 0
          ? 'Indique a faturação anual antes de guardar.'
          : creditMissing
            ? 'Indique o montante a refinanciar, ou desligue o refinanciamento, antes de guardar.'
            : null;
  const canSave = staff && saveBlocker === null;
  // Empresa já registada com o NIF que está a ser escrito: o diagnóstico vai para ela.
  const existingByNif = quickCreate && nifValid ? companies.data?.find((entry) => entry.nif === typedNif) : undefined;
  // Onde o diagnóstico fica gravado, dito por extenso ao lado do botão.
  const destination = quickCreate
    ? existingByNif
      ? `Fica gravado em ${existingByNif.name} · NIF ${existingByNif.nif}, que já está registada.`
      : `Fica gravado numa empresa nova: ${typedName || 'nome por indicar'} · NIF ${nifValid ? typedNif : 'por indicar'}.`
    : company
      ? `Fica gravado em ${company.name} · NIF ${company.nif}.`
      : '';

  const save = () => {
    setTriedSave(true);
    if (!canSave) return;
    const payload: CreateAssessmentPayload = {
      ...toStressTestInput(state),
      ...(quickCreate ? { company: { name: typedName, nif: typedNif } } : {}),
    };
    createAssessment.mutate(payload, {
      onSuccess: (detail) => {
        draft.clear();
        // O NIF já existia: o plano diz a que empresa o diagnóstico ficou associado.
        const planState: PlanNavigationState =
          detail.companyResolution === 'existing' ? { existingCompany: { typedName } } : {};
        navigate(`/plano/${detail.id}`, { state: planState });
      },
    });
  };

  const pickAmount = (field: 'revenue' | 'credit', patch: Partial<WizardState>) => {
    update(patch);
    setPicks((current) => ({ ...current, [field]: current[field] + 1 }));
  };
  const resetAmountFields = () => setPicks((current) => ({ revenue: current.revenue + 1, credit: current.credit + 1 }));

  // Visitante sem conta: o passo seguinte é pedir o diagnóstico completo à equipa, por email,
  // já com o que simulou. Só existe se quem publicou tiver indicado o endereço de contacto.
  const simulatedRisk = publicSimulation.isPlaceholderData ? null : publicSimulation.data?.commercialRisk;
  const requestHref =
    mode === 'anonymous' && contact
      ? diagnosisRequestMailto(
          contact,
          state.annualRevenue > 0
            ? {
                sector: SECTOR_PROFILE_LABELS[state.sectorProfile],
                annualRevenue: formatEUR(state.annualRevenue),
                topClientsShare: `${state.topClientsShare}%`,
                atRisk: simulatedRisk ? formatEuroRange(simulatedRisk.low, simulatedRisk.high) : null,
              }
            : undefined,
        )
      : null;

  const dealbreaker = catalog.data?.dealbreakers.find((rule) => rule.sector === state.sectorProfile);
  const spreadBps = catalog.data?.spreadPenaltyBps;

  return (
    <div
      className={cn(
        // Em ecrãs estreitos é uma coluna (e não uma grelha), para o número em risco poder
        // ficar preso ao topo ao longo de todo o formulário.
        'flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start',
        // Um controlo que recebe o foco é trazido para baixo do que está preso no topo (o
        // cabeçalho e, em ecrãs estreitos, o número em risco), e não para trás disso.
        '[--focus-top:calc(var(--pin-top)_+_var(--pin-height)_+_0.75rem)] lg:[--focus-top:calc(var(--pin-top)_+_0.75rem)]',
        '[&_:is(a,button,input,summary,[role=slider])]:scroll-mt-[var(--focus-top)]',
      )}
      style={{ '--pin-top': `${headerHeight}px`, '--pin-height': `${pinnedHeight}px` } as CSSProperties}
    >
      <div className="space-y-4">
        <CompanyBlock
          mode={mode}
          companyName={company?.name ?? null}
          companyNif={company?.nif ?? null}
          quickCreate={quickCreate}
          existingName={existingByNif?.name ?? null}
          canToggleNew={staff && Boolean(company)}
          onToggleNew={draft.setNewCompany}
          state={state}
          update={update}
          showErrors={triedSave}
          nifValid={nifValid}
          nameValid={nameValid}
          previousDiagnosis={
            staff && company && !quickCreate ? (
              <PreviousDiagnosisOffer
                // Outra empresa, ou «Recomeçar», volta à oferta.
                key={`${company.id}-${draft.revision}`}
                record={company}
                current={state}
                touched={state.touched}
                onApply={(answers) => {
                  draft.applyAnswers(answers);
                  resetAmountFields();
                }}
                onUseRecord={(record) => {
                  update(record);
                  resetAmountFields();
                }}
              />
            ) : null
          }
        />
        {staff && draft.setAside && (
          <SetAsideNotice
            setAside={draft.setAside}
            companyName={company?.name ?? null}
            onApply={draft.applySetAside}
            onResume={draft.resumeSetAside}
            onDiscard={draft.discardSetAside}
          />
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>1 · Perfil e base exposta</CardTitle>
              <CardDescription>O setor muda o peso de cada exigência. A base exposta é a faturação nos 3 maiores clientes.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <p id="sector-label" className="text-xs font-medium text-slate-700">
                Perfil setorial
              </p>
              <RadioTiles
                labelledBy="sector-label"
                value={state.sectorProfile}
                options={SECTOR_OPTIONS}
                onChange={(sectorProfile) => update({ sectorProfile })}
                className="grid grid-cols-2 gap-2 xl:grid-cols-4"
              />
              {catalog.data && (
                <FieldHint>
                  {dealbreaker
                    ? `Piso de bloqueio: sem ${dealbreaker.triggers
                        .map((code) => REQUIREMENTS.find((requirement) => requirement.code === code)?.label)
                        .join(' ou ')}, o peso comercial nunca fica abaixo de ${formatNumberPt(dealbreaker.floorPoints / 100, 2)}.`
                    : 'Sem piso de bloqueio neste setor. Contam só os pesos das lacunas.'}
                </FieldHint>
              )}
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="annual-revenue">Faturação anual</Label>
                <EuroInput
                  key={`${draft.revision}-${picks.revenue}`}
                  id="annual-revenue"
                  value={state.annualRevenue}
                  onValueChange={(annualRevenue) => update({ annualRevenue })}
                  onInvalidChange={(revenue) => setUnread((current) => ({ ...current, revenue }))}
                />
                <Presets
                  values={REVENUE_PRESETS}
                  current={state.annualRevenue}
                  onPick={(annualRevenue) => pickAmount('revenue', { annualRevenue })}
                  label="Faturação"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label id="share-label">Concentração nos 3 maiores clientes</Label>
                  <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">{state.topClientsShare}%</span>
                </div>
                <Slider
                  aria-labelledby="share-label"
                  formatValue={(value) => `${value}%`}
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
              <CardDescription>
                Risco financeiro, separado da faturação. Sem rácios ESG, o refinanciamento agrava o spread
                {spreadBps ? ` em ${spreadBps} pontos base por ano` : ''}.
              </CardDescription>
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
                  key={`${draft.revision}-${picks.credit}`}
                  id="credit-line"
                  value={state.creditLineToRefinance}
                  onValueChange={(creditLineToRefinance) => update({ creditLineToRefinance })}
                  onInvalidChange={(credit) => setUnread((current) => ({ ...current, credit }))}
                  aria-invalid={creditMissing && triedSave ? true : undefined}
                  aria-describedby={creditMissing ? 'credit-line-missing' : undefined}
                />
                {creditMissing && !unread.credit && (
                  <FieldHint id="credit-line-missing" className="font-medium text-amber-800">
                    Indique o montante a refinanciar. Enquanto estiver a 0&nbsp;€, a banca não entra no cálculo.
                  </FieldHint>
                )}
                <Presets
                  values={CREDIT_PRESETS}
                  current={state.creditLineToRefinance}
                  onPick={(creditLineToRefinance) => pickAmount('credit', { creditLineToRefinance })}
                  label="Crédito"
                />
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
            {REQUIREMENTS.map((requirement) => {
              const field = requirement.answerField;
              const status = requirementStatus(requirement, input);
              const notApplicable = status === 'not_applicable';
              const amountMissing = notApplicable && creditMissing;
              // O peso só é conhecido com sessão (vem com o catálogo).
              const impact = !catalog.data
                ? null
                : requirement.channel === 'financial'
                  ? `${catalog.data.spreadPenaltyBps} bps/ano sobre o crédito`
                  : `${formatWeight(forSector(catalog.data.parameters[requirement.code].weightPoints, state.sectorProfile))} na exposição`;
              return (
                <li key={requirement.code} className={cn('flex items-center gap-4 px-4 py-3', notApplicable && 'bg-slate-50')}>
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`req-${requirement.code}`} className="text-sm font-medium text-slate-900">
                      {requirement.label}
                    </label>
                    <p className="text-xs text-slate-600">
                      Exigido por {describeSources(requirement.requiredBy)}
                      {amountMissing
                        ? ' · falta o montante a refinanciar'
                        : notApplicable
                          ? ' · só conta com refinanciamento a <18 meses'
                          : ''}
                    </p>
                  </div>
                  {impact && <span className="hidden font-mono text-xs tabular-nums text-slate-700 sm:block">{impact}</span>}
                  {amountMissing ? <Badge tone="high">Falta o montante</Badge> : <StatusPill status={status} />}
                  <Switch
                    id={`req-${requirement.code}`}
                    checked={state[field]}
                    onCheckedChange={(checked) => update({ [field]: checked } as Partial<WizardState>)}
                    aria-label={`${requirement.label}: ${state[field] ? 'tem' : 'não tem'}`}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <LiveImpactPreview
        source={
          staff
            ? {
                kind: 'full',
                preview,
                catalog: catalog.data,
                loadError: catalog.isError ? errorMessage(catalog.error) : null,
                onRetry: () => void catalog.refetch(),
              }
            : {
                kind: 'public',
                simulation: publicSimulation.data,
                updating: publicSimulation.isFetching || publicSimulation.isPlaceholderData,
                error: publicSimulation.isError ? errorMessage(publicSimulation.error) : null,
                onRetry: () => void publicSimulation.refetch(),
              }
        }
        sectorProfile={state.sectorProfile}
        annualRevenue={state.annualRevenue}
        creditLineToRefinance={input.creditLineToRefinance}
        creditAmountMissing={creditMissing}
        onUseSampleRevenue={() => pickAmount('revenue', { annualRevenue: 5_000_000 })}
        pinnedRef={pinnedRef}
        saveArea={
          <SaveArea
            mode={mode}
            requestHref={requestHref}
            contact={contact}
            destination={destination}
            canRestart={state.touched}
            onRestart={draft.restart}
            blocker={triedSave ? saveBlocker : null}
            saving={createAssessment.isPending}
            error={createAssessment.isError ? errorMessage(createAssessment.error) : null}
            onSave={save}
          />
        }
      />
    </div>
  );
}

/** Uma simulação que saiu do ecrã quando o consultor escolheu uma empresa: decide ele o que lhe fazer. */
function SetAsideNotice({
  setAside,
  companyName,
  onApply,
  onResume,
  onDiscard,
}: {
  setAside: WizardState;
  companyName: string | null;
  onApply: () => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const typedName = setAside.companyName.trim();
  return (
    <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950">
      <p className="text-sm">
        <span className="font-medium">Tem uma simulação por guardar</span>
        {typedName ? ` para «${typedName}»` : ', feita sem empresa selecionada'}: {SECTOR_PROFILE_LABELS[setAside.sectorProfile]},
        faturação <span className="font-mono tabular-nums">{formatEUR(setAside.annualRevenue)}</span>.
        {companyName ? ` Este ecrã mostra os dados da ficha de ${companyName}.` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {companyName && (
          <Button size="sm" variant="outline" onClick={onApply}>
            Usar essas respostas em {companyName}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onResume}>
          Continuar como empresa nova
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </div>
  );
}

function RestartButton({ onRestart }: { onRestart: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="w-full" onClick={onRestart}>
      <RotateCcw aria-hidden /> Recomeçar
    </Button>
  );
}

function SaveArea({
  mode,
  requestHref,
  contact,
  destination,
  canRestart,
  onRestart,
  blocker,
  saving,
  error,
  onSave,
}: {
  mode: WizardMode;
  /** Ligação para o visitante pedir o diagnóstico completo por email. Null sem contacto configurado. */
  requestHref: string | null;
  /** O endereço de contacto, por extenso, para quem não tem programa de email. */
  contact: string | null;
  /** Onde o diagnóstico fica gravado (só para a equipa P4S). */
  destination: string;
  canRestart: boolean;
  onRestart: () => void;
  /** O que falta para gravar, depois de se ter tentado. */
  blocker: string | null;
  saving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  if (mode === 'anonymous') {
    return (
      <div className="space-y-2">
        {requestHref ? (
          <>
            <Button asChild className="w-full">
              <a href={requestHref} data-testid="request-diagnosis">
                <Mail aria-hidden /> Pedir o diagnóstico completo
              </a>
            </Button>
            <p className="text-2xs text-slate-600">
              Abre uma mensagem para a equipa Plan4Sustain, já com esta simulação. Se não abrir, escreva para{' '}
              <span className="font-medium text-slate-900 [overflow-wrap:anywhere]">{contact}</span>.
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-700">O diagnóstico completo é feito com a equipa Plan4Sustain.</p>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link to="/entrar?next=/">
            <LogIn aria-hidden /> Já tenho conta
          </Link>
        </Button>
        <p className="text-2xs text-slate-600">As respostas ficam neste separador até entrar.</p>
        {canRestart && <RestartButton onRestart={onRestart} />}
      </div>
    );
  }
  if (mode === 'company') {
    return (
      <div className="space-y-2">
        <Button asChild variant="outline" className="w-full">
          <Link to="/plano">
            <ClipboardList aria-hidden /> Abrir o plano de ação da empresa
          </Link>
        </Button>
        <p className="text-2xs text-slate-600">
          Isto é uma simulação: não altera o diagnóstico nem a proposta. Um novo diagnóstico é gravado com o seu consultor
          Plan4Sustain.
        </p>
        {canRestart && <RestartButton onRestart={onRestart} />}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error && <ErrorBanner title="O diagnóstico não foi guardado." message={error} onRetry={onSave} retrying={saving} />}
      <Button className="h-auto min-h-9 w-full whitespace-normal px-2 py-1.5" onClick={onSave} disabled={saving}>
        {saving ? 'A guardar…' : 'Guardar Diagnóstico e Gerar Plano de Ação'}
        {!saving && <ArrowRight aria-hidden />}
      </Button>
      {blocker && <FieldError>{blocker}</FieldError>}
      {destination && (
        <p className="text-2xs text-slate-700" data-testid="save-destination">
          {destination}
        </p>
      )}
      {canRestart && <RestartButton onRestart={onRestart} />}
    </div>
  );
}

function CompanyBlock({
  mode,
  companyName,
  companyNif,
  quickCreate,
  existingName,
  canToggleNew,
  onToggleNew,
  state,
  update,
  showErrors,
  nifValid,
  nameValid,
  previousDiagnosis,
}: {
  mode: WizardMode;
  companyName: string | null;
  companyNif: string | null;
  quickCreate: boolean;
  /** Nome da empresa já registada com o NIF que está a ser escrito. */
  existingName: string | null;
  canToggleNew: boolean;
  onToggleNew: (value: boolean) => void;
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  showErrors: boolean;
  nifValid: boolean;
  nameValid: boolean;
  /** Oferta de partir das respostas do diagnóstico anterior da empresa selecionada. */
  previousDiagnosis: ReactNode;
}) {
  if (mode !== 'staff') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <Badge tone="dark">Simulação</Badge>
        <p className="text-sm text-slate-700">
          {mode === 'company' && companyName
            ? `Simulação para ${companyName}. Mostra a ordem de grandeza do que está em jogo com outras respostas. O diagnóstico e a proposta em vigor estão no plano de ação.`
            : 'Sem registo, vê a ordem de grandeza do que está em jogo. O valor estimado, o plano e o preço fechado ficam no diagnóstico completo.'}
        </p>
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
            {existingName ? (
              <FieldHint className="font-medium text-amber-800 md:col-span-2" data-testid="nif-already-registered">
                NIF já registado como «{existingName}». O diagnóstico fica associado a essa empresa, com o nome que lá está.
              </FieldHint>
            ) : (
              <FieldHint className="md:col-span-2">
                Se o NIF já existir, o diagnóstico fica associado à empresa registada, com o nome que lá está.
              </FieldHint>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-900">
              <span className="font-medium">{companyName}</span>{' '}
              <span className="font-mono text-xs tabular-nums text-slate-600">NIF {companyNif}</span>
            </p>
            {previousDiagnosis}
          </>
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

function StatusPill({ status }: { status: 'compliant' | 'gap' | 'not_applicable' }): ReactNode {
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
