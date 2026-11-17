// Contratos de resposta da API. Só tipos: o frontend importa este ficheiro.

import type { RemediationSummary } from '../services/remediation-summary.js';
import type {
  RequirementCode,
  RequirementSource,
  RequirementStatus,
  RiskChannel,
  StressTestInput,
} from '../services/requirements.js';
import type { GeneratedTaskDraft } from '../services/task-generator.service.js';
import type {
  AssessmentStatus,
  Company,
  PublicUser,
  SectorProfile,
  Task,
  TaskExecutor,
  TaskPhase,
  TaskPriority,
  UserRole,
} from './domain.js';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ── Sessão ──────────────────────────────────────────────────────────────────────────

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Segundos até o accessToken expirar. */
  expiresIn: number;
  user: PublicUser;
  companyId: string | null;
}

export interface MeResponse {
  user: PublicUser;
  companyId: string | null;
  company: Company | null;
}

// ── Utilizadores ────────────────────────────────────────────────────────────────────

export interface AssignableUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

/** invited: ainda não definiu palavra-passe. disabled: conta desativada. */
export type UserAccountStatus = 'active' | 'invited' | 'disabled';

export interface ManagedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string | null;
  status: UserAccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
  /** Validade do link de palavra-passe por usar, se existir. */
  pendingLinkExpiresAt: string | null;
}

export type PasswordLinkPurpose = 'invite' | 'reset';

/** Link de uso único para definir a palavra-passe. O token só é devolvido uma vez. */
export interface PasswordLink {
  token: string;
  purpose: PasswordLinkPurpose;
  expiresAt: string;
}

export interface CreatedUser {
  user: ManagedUser;
  passwordLink: PasswordLink;
}

/** O que a página de definição de palavra-passe mostra antes de o utilizador escrever. */
export interface PasswordLinkInfo {
  fullName: string;
  email: string;
  purpose: PasswordLinkPurpose;
  expiresAt: string;
}

// ── Diagnóstico ─────────────────────────────────────────────────────────────────────

/** Fotografia de um requisito tal como foi avaliado (matriz de lacunas). */
export interface RequirementSnapshot {
  code: RequirementCode;
  label: string;
  channel: RiskChannel;
  status: RequirementStatus;
  weightPoints: number;
  /** Caso ou fonte que sustenta o peso, quando existe no catálogo. */
  evidence?: string;
  requiredBy: RequirementSource[];
  requiredByLabel: string;
  solution: {
    title: string;
    executorType: TaskExecutor;
    phase: TaskPhase;
    priority: TaskPriority;
    estimatedCost: number;
    deadlineDays: number;
  };
}

export interface DealbreakerSnapshot {
  sector: SectorProfile;
  floorPoints: number;
  triggeredBy: RequirementCode[];
  reason: string;
  raisedWeight: boolean;
}

export type SuggestedTask = GeneratedTaskDraft;

/** Simulação completa. Só para quem tem sessão. */
export interface FullSimulation {
  access: 'full';
  engineVersion: string;
  sectorProfile: SectorProfile;
  riskScore: number;
  commercialRevenueAtRisk: number;
  commercialRevenueAtRiskShare: number;
  estimatedSpreadPenalty: number;
  exposedClientRevenue: number;
  criticalGapCount: number;
  dealbreaker: DealbreakerSnapshot | null;
  requirements: RequirementSnapshot[];
  remediationSummary: RemediationSummary;
  suggestedTasks: SuggestedTask[];
}

/** Escalão em euros, com os limites que o definem. */
export interface PublicRange {
  low: number;
  high: number;
}

/**
 * Simulação pública (sem sessão): ordens de grandeza por escalões fixos. Não leva pesos,
 * pisos, preços nem prazos, para a tabela de preços e o modelo não ficarem públicos.
 */
export interface PublicSimulation {
  access: 'public';
  engineVersion: string;
  sectorProfile: SectorProfile;
  /** Faturação nos 3 maiores clientes (sai só dos dados introduzidos). */
  exposedClientRevenue: number;
  /** Faturação comercial em risco, em escalão. Null sem exposição. */
  commercialRisk: (PublicRange & { lowShare: number; highShare: number }) | null;
  /** Sobrecusto bancário anual, em escalão. Null se não se aplica. */
  spreadPenalty: (PublicRange & { lowBps: number; highBps: number }) | null;
  gapCount: number;
  criticalGapCount: number;
  /** Motivo do bloqueio setorial, quando existe. */
  sectorBlocker: string | null;
  gaps: {
    code: RequirementCode;
    label: string;
    requiredByLabel: string;
    solutionTitle: string;
    phase: TaskPhase;
    executorType: TaskExecutor;
    critical: boolean;
  }[];
}

export type SimulationResponse = FullSimulation | PublicSimulation;

/** Conteúdo de assessments.raw_responses. */
export interface AssessmentSnapshot {
  engineVersion: string;
  baseDate: string;
  input: StressTestInput;
  exposedClientRevenue: number;
  commercialGapPoints: number;
  commercialRiskPoints: number;
  commercialRevenueAtRiskShare: number;
  criticalGapCount: number;
  /** Agravamento de spread usado no cálculo. Ausente em diagnósticos anteriores à versão 3. */
  spreadPenaltyBps?: number;
  dealbreaker: DealbreakerSnapshot | null;
  requirements: RequirementSnapshot[];
}

export interface CompanySummary {
  id: string;
  name: string;
  nif: string;
  cae: string;
  sectorProfile: SectorProfile;
  annualRevenue: number;
  exportPercentage: number;
}

export interface AssessmentDetail {
  id: string;
  status: AssessmentStatus;
  sectorProfile: SectorProfile;
  riskScore: number;
  commercialRevenueAtRisk: number;
  estimatedSpreadPenalty: number;
  creditLineToRefinance: number;
  conductedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  company: CompanySummary;
  snapshot: AssessmentSnapshot;
  /** Calculado sobre as tarefas atuais (reflete o que foi configurado na proposta). */
  remediationSummary: RemediationSummary;
  tasks: Task[];
}

export interface AssessmentListEntry {
  id: string;
  status: AssessmentStatus;
  sectorProfile: SectorProfile;
  riskScore: number;
  commercialRevenueAtRisk: number;
  estimatedSpreadPenalty: number;
  taskCount: number;
  conductedByName: string | null;
  completedAt: string | null;
  createdAt: string;
}
