// Formatação pt-PT. Os formatadores de dinheiro e datas são os mesmos do backend.

import type {
  SectorProfile,
  TaskDomain,
  TaskExecutor,
  TaskPhase,
  TaskPriority,
  TaskStatus,
  UserRole,
} from '@engine/models/domain';
import { SECTOR_PROFILE_LABELS } from '@engine/models/domain';
import { PHASE_WINDOWS, phaseWindowText } from '@engine/services/requirements';
import { formatEUR, formatMagnitudeEUR, formatNumberPt, formatPercent } from '@engine/utils/currency';

export {
  formatApproxEUR,
  formatEUR,
  formatMagnitudeEUR,
  formatNumberPt,
  formatPercent,
} from '@engine/utils/currency';
export { addDays, daysBetween, formatDatePt, todayInLisbon } from '@engine/utils/dates';
export { PHASE_WINDOWS, SECTOR_PROFILE_LABELS, phaseWindowText };

export const EXECUTOR_LABELS: Record<TaskExecutor, string> = {
  p4s: 'P4S',
  partner: 'Parceiro Segurança',
  internal: 'Interno',
};

export const EXECUTOR_SHORT_LABELS: Record<TaskExecutor, string> = {
  p4s: 'P4S',
  partner: 'Parceiro',
  internal: 'Interno',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'Em Curso',
  review: 'Em Revisão',
  completed: 'Concluído',
};

export const DOMAIN_LABELS: Record<TaskDomain, string> = {
  carbon_footprint: 'Pegada de carbono',
  ecovadis: 'EcoVadis',
  banking_esg: 'ESG bancário',
  information_security: 'Segurança da informação',
  circular_economy: 'Economia circular',
};

/** Nome da fase. As janelas («0–60 dias») vêm do motor, de onde saem também os prazos. */
export const phaseLabel = (phase: TaskPhase) => PHASE_WINDOWS[phase].label;

export const PHASE_SHORT_LABELS: Record<TaskPhase, string> = {
  phase_1_urgent: 'Fase 1',
  phase_2_structural: 'Fase 2',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin P4S',
  consultant: 'Consultor P4S',
  company_user: 'Empresa',
};

export const sectorLabel = (sector: SectorProfile) => SECTOR_PROFILE_LABELS[sector];

const DATE_TIME_PT = new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Instante (ISO) em hora de Lisboa: «24/11/2026, 17:55». */
export function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_PT.format(date);
}

/** Endereço que o utilizador abre para definir a palavra-passe. O token vai no fragmento, que não chega a servidores nem a registos de acesso. */
export const passwordLinkUrl = (token: string) => `${window.location.origin}/definir-palavra-passe#token=${token}`;

/** Sobrecusto anual estimado, como ordem de grandeza: «≈ +10 mil €/ano». */
export const formatApproxPerYear = (value: number) =>
  value > 0 ? `≈\u00A0+${formatMagnitudeEUR(value)}/ano` : `${formatEUR(0)}/ano`;

/** Escalão em euros: «780 mil € a 1,2 M €», ou «até 240 mil €» quando começa em zero. */
export const formatEuroRange = (low: number, high: number) =>
  low > 0 ? `${formatMagnitudeEUR(low)} a ${formatMagnitudeEUR(high)}` : `até ${formatMagnitudeEUR(high)}`;

/** Valor calculado, para quem quer ver o número por trás da ordem de grandeza. */
export const exactValueTitle = (value: number, suffix = '') => `Valor calculado: ${formatEUR(value)}${suffix}`;

/** Pontos base → percentagem ao ano, como um diretor financeiro a diz: 40 → «0,40%». */
export const formatBasisPoints = (bps: number) => `${formatNumberPt(bps / 100, 2)}%`;

/** Pontos de peso → «+0,45». */
export const formatWeight = (points: number) => `+${formatNumberPt(points / 100, 2)}`;

/**
 * Custo em percentagem da faturação em risco. `nonZero` diz que o custo existe: a percentagem
 * chega arredondada, e um custo pequeno face a um risco grande não pode aparecer como «0,0%».
 */
export function formatShareOfRisk(percent: number, nonZero = percent > 0): string {
  if (nonZero && percent < 0.1) return '<0,1%';
  return formatPercent(percent, 1);
}

/** «2M €», «2,5M €», «500k €» para botões rápidos. */
export function formatCompactEUR(value: number): string {
  if (value >= 1_000_000) return `${formatNumberPt(value / 1_000_000, value % 1_000_000 === 0 ? 0 : 1)}M €`;
  if (value >= 1_000) return `${formatNumberPt(value / 1_000, 0)}k €`;
  return formatEUR(value);
}

/** Lê um valor em euros escrito à mão («1.450.000», «6,5M», «500 mil») ou diz porque não o percebe. */
export { parseEuroInput, type EuroParse, type EuroParseOptions } from './euro-parse';
