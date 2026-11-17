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

// ── Informação pública ──────────────────────────────────────────────────────────────

/** O que a P4S configurou para mostrar a toda a gente: contacto e condições da proposta. */
export interface PublicInfo {
  contactEmail: string | null;
  legalIdentity: string | null;
  proposalTerms: string[];
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

/** Possível responsável por uma tarefa. Sem email nem papel: os clientes também recebem esta lista. */
export interface AssignableUser {
  id: string;
  fullName: string;
  team: 'p4s' | 'company';
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

/** Solução-tipo de um requisito no dia do diagnóstico, com o preço e o prazo de catálogo. */
export interface RequirementSolution {
  title: string;
  executorType: TaskExecutor;
  phase: TaskPhase;
  priority: TaskPriority;
  estimatedCost: number;
  deadlineDays: number;
}

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
  solution: RequirementSolution;
}

/**
 * Um requisito como a API o devolve. O peso de cada requisito e o preço e o prazo de catálogo
 * são da equipa P4S: para as contas das empresas vêm a null (e a fonte do peso não vem).
 */
export interface RequirementView extends Omit<RequirementSnapshot, 'weightPoints' | 'solution'> {
  weightPoints: number | null;
  solution: Omit<RequirementSolution, 'estimatedCost' | 'deadlineDays'> & {
    estimatedCost: number | null;
    deadlineDays: number | null;
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

/**
 * A fotografia como a API a devolve. A equipa P4S recebe-a inteira. As contas das empresas
 * recebem o que o resumo impresso já lhes dá (dados de partida, score, piso setorial e
 * agravamento de spread) e não recebem o que permitiria reconstruir o catálogo: o peso de
 * cada requisito, a soma das lacunas e os preços e prazos de catálogo.
 */
export interface AssessmentSnapshotView extends Omit<AssessmentSnapshot, 'commercialGapPoints' | 'requirements'> {
  /** Soma dos pesos das lacunas, antes do piso e do teto. Null para as contas das empresas. */
  commercialGapPoints: number | null;
  requirements: RequirementView[];
}

/** Datas da proposta de honorários (dias de calendário de Lisboa, AAAA-MM-DD). */
export interface ProposalInfo {
  issuedOn: string;
  validUntil: string;
  validityDays: number;
  /** Passou a validade: os honorários e os prazos deixam de estar garantidos até a P4S reemitir. */
  expired: boolean;
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
  /** Quem gravou o diagnóstico. */
  conductedByName: string | null;
  completedAt: string | null;
  createdAt: string;
  company: CompanySummary;
  snapshot: AssessmentSnapshotView;
  proposal: ProposalInfo;
  /** Calculado sobre as tarefas atuais (reflete o que foi configurado na proposta). */
  remediationSummary: RemediationSummary;
  tasks: Task[];
}

/** session: a empresa selecionada. created: criada agora pelo NIF. existing: já existia com esse NIF. */
export type CompanyResolution = 'session' | 'created' | 'existing';

/** Resposta de POST /assessments. */
export interface CreatedAssessment extends AssessmentDetail {
  companyResolution: CompanyResolution;
}

export interface AssessmentListEntry {
  id: string;
  status: AssessmentStatus;
  sectorProfile: SectorProfile;
  riskScore: number;
  commercialRevenueAtRisk: number;
  estimatedSpreadPenalty: number;
  taskCount: number;
  /** false: rascunho ou diagnóstico de uma versão anterior, sem dados que se consigam abrir. */
  openable: boolean;
  proposal: ProposalInfo;
  conductedByName: string | null;
  completedAt: string | null;
  createdAt: string;
}
