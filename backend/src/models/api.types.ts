// Contratos de resposta da API. Só tipos: o frontend importa este ficheiro.

import type {
  RequirementCode,
  RequirementSource,
  RequirementStatus,
  RiskChannel,
  StressTestInput,
} from '../services/requirements.catalog.js';
import type { RemediationSummary } from '../services/remediation-summary.js';
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

export interface AssignableUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

/** Fotografia de um requisito tal como foi avaliado (matriz de lacunas). */
export interface RequirementSnapshot {
  code: RequirementCode;
  label: string;
  channel: RiskChannel;
  status: RequirementStatus;
  weightPoints: number;
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

export interface SimulationResponse {
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
