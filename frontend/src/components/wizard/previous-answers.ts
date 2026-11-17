// Repetir um diagnóstico: partir das respostas do anterior.
//
// O wizard abre sempre com tudo por fazer (o pior caso). Numa empresa que já tem um
// diagnóstico, repor as respostas à mão demora e convida a vender um entregável que a fábrica
// já tem. Por isso o consultor pode pedir as respostas do diagnóstico anterior e mudar só o
// que for diferente. Nunca são aplicadas sozinhas: é ele que escolhe.
// Funções puras, sem React, para se poderem testar.

import type { AssessmentListEntry } from '@engine/models/api.types';
import type { SectorProfile } from '@engine/models/domain';
import { ANSWER_FIELDS, type AnswerField } from '@engine/services/requirements';
import { DEFAULT_STATE, parseDraft, type WizardState } from './wizard-draft';

/** O diagnóstico mais recente que se consegue abrir. A lista pode trazer versões antigas, que não abrem. */
export function latestOpenable(entries: readonly AssessmentListEntry[]): AssessmentListEntry | null {
  let latest: AssessmentListEntry | null = null;
  for (const entry of entries) {
    if (entry.openable && (!latest || entry.createdAt > latest.createdAt)) latest = entry;
  }
  return latest;
}

/** Respostas de um diagnóstico gravado, na forma em que o rascunho as guarda. */
export type PreviousAnswers = Pick<
  WizardState,
  'sectorProfile' | 'annualRevenue' | 'topClientsShare' | 'hasRefinancing' | AnswerField
> &
  Partial<Pick<WizardState, 'creditLineToRefinance'>>;

/**
 * Lê as respostas gravadas num diagnóstico (snapshot.input). Null se o que veio do servidor
 * não tiver a forma certa. Crédito a zero quer dizer que não havia refinanciamento: o
 * interruptor fica desligado e o montante não vem, para não apagar o que estiver no rascunho.
 */
export function answersFromSnapshot(input: unknown): PreviousAnswers | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  const credit = raw.creditLineToRefinance;
  // As mesmas regras do rascunho lido do storage: todas as respostas, com tipos e limites
  // certos, ou não entra nenhuma. Uma resposta em falta não é dada como «não tem».
  const checked = parseDraft({
    ...DEFAULT_STATE,
    sectorProfile: raw.sectorProfile,
    annualRevenue: raw.annualRevenue,
    topClientsShare: raw.topClientsShare,
    creditLineToRefinance: credit,
    hasRefinancing: typeof credit === 'number' && credit > 0,
    ...Object.fromEntries(ANSWER_FIELDS.map((field) => [field, raw[field]])),
  });
  if (!checked) return null;
  const answers: PreviousAnswers = {
    sectorProfile: checked.sectorProfile,
    annualRevenue: checked.annualRevenue,
    topClientsShare: checked.topClientsShare,
    hasRefinancing: checked.hasRefinancing,
    ecovadis: checked.ecovadis,
    carbonFootprintScope12: checked.carbonFootprintScope12,
    carbonFootprintScope3: checked.carbonFootprintScope3,
    bankingEsgMetrics: checked.bankingEsgMetrics,
    tisaxOrNis2: checked.tisaxOrNis2,
  };
  return checked.hasRefinancing ? { ...answers, creditLineToRefinance: checked.creditLineToRefinance } : answers;
}

/**
 * Aplica ao rascunho as respostas de um diagnóstico anterior. Conta como alteração feita pelo
 * utilizador: o rascunho fica mexido, para não ser trocado pela ficha da empresa ao recarregar.
 */
export function applyPreviousAnswers(draft: WizardState, answers: PreviousAnswers): WizardState {
  return { ...draft, ...answers, touched: true };
}

/** Setor e faturação da ficha da empresa, como estão hoje. */
export interface CompanyRecord {
  sectorProfile: SectorProfile;
  annualRevenue: number;
}

/**
 * O que as respostas de um diagnóstico anterior têm de diferente da ficha da empresa. A ficha
 * pode ter sido corrigida depois do diagnóstico, e nesse caso é ela que está certa. Uma ficha
 * sem faturação não conta: o rascunho também não a usa.
 */
export function differencesFromRecord(
  answers: Pick<PreviousAnswers, 'sectorProfile' | 'annualRevenue'>,
  record: CompanyRecord,
): { sector: boolean; revenue: boolean } {
  return {
    sector: answers.sectorProfile !== record.sectorProfile,
    revenue: record.annualRevenue > 0 && answers.annualRevenue !== record.annualRevenue,
  };
}
