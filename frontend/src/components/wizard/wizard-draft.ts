// Rascunho do stress test: o que o utilizador já respondeu e a quem pertence.
//
// O rascunho fica no sessionStorage para sobreviver a uma recarga a meio da reunião. Por
// isso tem dono, para nunca passar de uma reunião para a seguinte:
//  - pertence à pessoa que o fez: outra pessoa, ou o fim da sessão, começa do zero;
//  - pertence a uma empresa: ao mudar de empresa, o ecrã mostra os dados da ficha dessa
//    empresa. Uma simulação da equipa P4S feita sem empresa, ou para uma empresa nova,
//    fica de parte e só é aplicada se o consultor o pedir;
//  - o modo «empresa nova» faz parte do rascunho, para não se perder ao recarregar.
// Funções puras, sem React, para se poderem testar.

import { SECTOR_PROFILES, type SectorProfile } from '@engine/models/domain';
import { ANSWER_FIELDS, type AnswerField, type StressTestInput } from '@engine/services/requirements';
import { readStorage, writeStorage } from '@/lib/utils';

export interface WizardState extends Record<AnswerField, boolean> {
  companyName: string;
  companyNif: string;
  sectorProfile: SectorProfile;
  annualRevenue: number;
  topClientsShare: number;
  hasRefinancing: boolean;
  creditLineToRefinance: number;
  /** A equipa P4S está a registar uma empresa nova, e não a diagnosticar a da sessão. */
  newCompany: boolean;
  /** Empresa da sessão com que o rascunho foi preenchido (null: sem empresa). */
  prefilledFor: string | null;
  /** Quem fez o rascunho (null: visitante sem sessão). */
  owner: string | null;
  /** O utilizador já mexeu em algum controlo. */
  touched: boolean;
}

export const DEFAULT_STATE: WizardState = {
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
  newCompany: false,
  prefilledFor: null,
  owner: null,
  touched: false,
};

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

/** Quem está a usar o wizard e que empresa tem selecionada. */
export interface DraftContext {
  userId: string | null;
  staff: boolean;
  company: { id: string; sectorProfile: SectorProfile; annualRevenue: number } | null;
}

/** Rascunho limpo, com o setor e a faturação da ficha da empresa da sessão (quando há uma). */
export function freshDraft(ctx: DraftContext): WizardState {
  const { company } = ctx;
  return {
    ...DEFAULT_STATE,
    owner: ctx.userId,
    prefilledFor: company?.id ?? null,
    ...(company
      ? { sectorProfile: company.sectorProfile, ...(company.annualRevenue > 0 ? { annualRevenue: company.annualRevenue } : {}) }
      : {}),
  };
}

/** Formulário vazio para registar uma empresa nova, sem herdar nada da empresa da sessão. */
export function newCompanyDraft(ctx: DraftContext): WizardState {
  return { ...DEFAULT_STATE, owner: ctx.userId, prefilledFor: ctx.company?.id ?? null, newCompany: true };
}

export interface ReconciledDraft {
  draft: WizardState;
  /** Simulação que deixou de estar no ecrã e fica de parte, para o consultor decidir o que lhe fazer. */
  setAside: WizardState | null;
}

/**
 * Acerta o rascunho com quem está a usar o wizard. Chamada ao abrir o ecrã e sempre que a
 * sessão ou a empresa selecionada mudam.
 */
export function reconcileDraft(draft: WizardState, ctx: DraftContext): ReconciledDraft {
  const companyId = ctx.company?.id ?? null;

  // Outra pessoa, ou fim de sessão: o rascunho de uma sessão não passa para a seguinte.
  if (draft.owner !== null && draft.owner !== ctx.userId) return { draft: freshDraft(ctx), setAside: null };
  // Simulação feita antes de entrar: fica com quem entrou.
  const owned = draft.owner === ctx.userId ? draft : { ...draft, owner: ctx.userId };
  if (owned.prefilledFor === companyId) return { draft: owned, setAside: null };

  // A empresa da sessão mudou.
  if (!owned.touched || companyId === null) return { draft: freshDraft(ctx), setAside: null };
  // A conta de uma empresa só tem a sua: a simulação que fez antes de entrar mantém-se.
  if (!ctx.staff && owned.prefilledFor === null) return { draft: { ...owned, prefilledFor: companyId }, setAside: null };
  // Equipa P4S: uma simulação sem empresa, ou de uma empresa nova, não passa em silêncio para
  // a empresa que acabou de ser escolhida. O ecrã mostra a ficha dessa empresa e a simulação
  // fica de parte.
  if (ctx.staff && (owned.prefilledFor === null || owned.newCompany)) return { draft: freshDraft(ctx), setAside: owned };
  // Rascunho de outra empresa: começa pela ficha desta.
  return { draft: freshDraft(ctx), setAside: null };
}

/** Aplica à empresa da sessão as respostas de uma simulação que tinha ficado de parte. */
export function applyToSessionCompany(setAside: WizardState, ctx: DraftContext): WizardState {
  return {
    ...setAside,
    companyName: '',
    companyNif: '',
    newCompany: false,
    owner: ctx.userId,
    prefilledFor: ctx.company?.id ?? null,
    touched: true,
  };
}

/** Retoma a simulação que tinha ficado de parte como registo de uma empresa nova. */
export function resumeAsNewCompany(setAside: WizardState, ctx: DraftContext): WizardState {
  return { ...setAside, newCompany: true, owner: ctx.userId, prefilledFor: ctx.company?.id ?? null, touched: true };
}

// ── Armazenamento ───────────────────────────────────────────────────────────────────

const DRAFT_KEY = 'p4s.wizard-draft';
const SET_ASIDE_KEY = 'p4s.wizard-set-aside';

const isFiniteNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

/** O que vem do storage pode ser de outra versão ou ter sido alterado: só entra se tiver a forma certa. */
export function parseDraft(raw: unknown): WizardState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const valid =
    typeof value.companyName === 'string' &&
    typeof value.companyNif === 'string' &&
    (SECTOR_PROFILES as readonly unknown[]).includes(value.sectorProfile) &&
    isFiniteNumber(value.annualRevenue, 0, 1e12) &&
    isFiniteNumber(value.topClientsShare, 0, 100) &&
    isFiniteNumber(value.creditLineToRefinance, 0, 1e12) &&
    typeof value.hasRefinancing === 'boolean' &&
    typeof value.newCompany === 'boolean' &&
    typeof value.touched === 'boolean' &&
    isNullableString(value.prefilledFor) &&
    isNullableString(value.owner) &&
    ANSWER_FIELDS.every((field) => typeof value[field] === 'boolean');
  if (!valid) return null;
  // Só os campos conhecidos, pela ordem do estado por omissão.
  const draft = { ...DEFAULT_STATE };
  for (const key of Object.keys(DEFAULT_STATE) as (keyof WizardState)[]) {
    (draft as Record<string, unknown>)[key] = value[key];
  }
  return draft;
}

export const loadDraft = (): WizardState => parseDraft(readStorage<unknown>('session', DRAFT_KEY)) ?? DEFAULT_STATE;
export const saveDraft = (draft: WizardState): void => writeStorage('session', DRAFT_KEY, draft);
export const loadSetAside = (): WizardState | null => parseDraft(readStorage<unknown>('session', SET_ASIDE_KEY));
export const saveSetAside = (draft: WizardState | null): void => writeStorage('session', SET_ASIDE_KEY, draft);

/** Fim de sessão: nada do que foi introduzido fica no separador para a pessoa seguinte. */
export function clearWizardDrafts(): void {
  writeStorage('session', DRAFT_KEY, null);
  writeStorage('session', SET_ASIDE_KEY, null);
}
