// Tipos de domínio partilhados. Ficheiro sem dependências de Node, para poder ser
// importado pelo frontend (motor de cálculo em tempo real).

export const USER_ROLES = ['admin', 'consultant', 'company_user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Equipa P4S. Trabalha sobre várias empresas clientes. */
export const STAFF_ROLES = ['admin', 'consultant'] as const satisfies readonly UserRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ASSESSMENT_STATUSES = ['draft', 'processing', 'completed'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ['backlog', 'in_progress', 'review', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_DOMAINS = [
  'carbon_footprint',
  'ecovadis',
  'banking_esg',
  'information_security',
  'circular_economy',
] as const;
export type TaskDomain = (typeof TASK_DOMAINS)[number];

export const TASK_EXECUTORS = ['internal', 'p4s', 'partner'] as const;
export type TaskExecutor = (typeof TASK_EXECUTORS)[number];

export const TASK_PHASES = ['phase_1_urgent', 'phase_2_structural'] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

export const SECTOR_PROFILES = [
  'automotive_molds',
  'agro_packaging',
  'heavy_process',
  'general_industrial',
] as const;
export type SectorProfile = (typeof SECTOR_PROFILES)[number];

export const SECTOR_PROFILE_LABELS: Record<SectorProfile, string> = {
  automotive_molds: 'Moldes e componentes automóvel',
  agro_packaging: 'Embalagem agroalimentar',
  heavy_process: 'Indústria de processo',
  general_industrial: 'Indústria transformadora geral',
};

/** Executores cujo preço é fixado pela P4S (preço e prazo fechados). */
export const PRICED_EXECUTORS = ['p4s', 'partner'] as const satisfies readonly TaskExecutor[];

export function isStaffRole(role: UserRole): role is StaffRole {
  return (STAFF_ROLES as readonly UserRole[]).includes(role);
}

export function isPricedExecutor(executor: TaskExecutor): boolean {
  return (PRICED_EXECUTORS as readonly TaskExecutor[]).includes(executor);
}

/** Conteúdo validado do JWT de acesso. */
export interface AuthUser {
  userId: string;
  companyId: string | null;
  role: UserRole;
}

/** Contexto de um pedido com empresa selecionada (multi-tenancy). */
export interface TenantContext {
  userId: string;
  companyId: string;
  role: UserRole;
}

export interface Company {
  id: string;
  name: string;
  nif: string;
  cae: string;
  annualRevenue: number;
  exportPercentage: number;
  sectorProfile: SectorProfile;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  companyId: string | null;
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  /** Sobe a cada mudança de palavra-passe ou desativação (invalida refresh tokens anteriores). */
  tokenVersion: number;
  /** Null: conta criada por convite, ainda sem palavra-passe definida. */
  passwordSetAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export type PublicUser = Omit<User, 'passwordHash' | 'tokenVersion'>;

export interface Assessment {
  id: string;
  companyId: string;
  conductedBy: string | null;
  status: AssessmentStatus;
  sectorProfile: SectorProfile;
  riskScore: number;
  /** Faturação comercial em risco (€). */
  revenueAtRisk: number;
  /** Crédito a renovar nos próximos 18 meses (€). */
  creditLineToRefinance: number;
  /** Sobrecusto financeiro anual por agravamento de spread (€/ano). */
  estimatedSpreadPenalty: number;
  rawResponses: Record<string, unknown>;
  completedAt: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  assessmentId: string;
  companyId: string;
  title: string;
  description: string | null;
  domain: TaskDomain;
  priority: TaskPriority;
  status: TaskStatus;
  executorType: TaskExecutor;
  phase: TaskPhase;
  includedInProposal: boolean;
  estimatedCost: number;
  /** Data ISO (YYYY-MM-DD), sem fuso horário. */
  deadline: string | null;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
