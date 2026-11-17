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

/** Sobrecusto anual estimado, como ordem de grandeza: «≈ +10 mil €/ano». */
export const formatApproxPerYear = (value: number) =>
  value > 0 ? `≈\u00A0+${formatMagnitudeEUR(value)}/ano` : `${formatEUR(0)}/ano`;

/** Escalão em euros: «780 mil € a 1,2 M €», ou «até 240 mil €» quando começa em zero. */
export const formatEuroRange = (low: number, high: number) =>
  low > 0 ? `${formatMagnitudeEUR(low)} a ${formatMagnitudeEUR(high)}` : `até ${formatMagnitudeEUR(high)}`;

/** Valor calculado, para quem quer ver o número por trás da ordem de grandeza. */
export const exactValueTitle = (value: number, suffix = '') => `Valor calculado: ${formatEUR(value)}${suffix}`;

/** Pontos de peso → «+0,45». */
export const formatWeight = (points: number) => `+${formatNumberPt(points / 100, 2)}`;

export function formatShareOfRisk(percent: number): string {
  if (percent > 0 && percent < 0.1) return '<0,1%';
  return formatPercent(percent, 1);
}

/** «2M €», «2,5M €», «500k €» para botões rápidos. */
export function formatCompactEUR(value: number): string {
  if (value >= 1_000_000) return `${formatNumberPt(value / 1_000_000, value % 1_000_000 === 0 ? 0 : 1)}M €`;
  if (value >= 1_000) return `${formatNumberPt(value / 1_000, 0)}k €`;
  return formatEUR(value);
}

/** Lê um valor em euros escrito à portuguesa («1.450.000», «1450000,50»). */
export function parseEuroInput(text: string): number {
  const normalized = text.replace(/\s|€/g, '').replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
