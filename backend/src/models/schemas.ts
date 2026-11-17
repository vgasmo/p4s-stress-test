// Contratos de entrada da API (validação estrita: campos desconhecidos são recusados).

import { z } from 'zod';
import { MAX_MONEY_AMOUNT } from '../services/stress-test-calculator.service.js';
import { formatEUR } from '../utils/currency.js';
import { isValidIsoDate } from '../utils/dates.js';
import { isPlainText, isSingleLineText, isValidCae, isValidNif } from '../utils/validation.js';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  SECTOR_PROFILES,
  STAFF_ROLES,
  TASK_DOMAINS,
  TASK_EXECUTORS,
  TASK_PHASES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from './domain.js';

// As mensagens que o zod gera sozinho (tipos, limites, campos desconhecidos) saem em português.
z.config(z.locales.pt());

const FORBIDDEN_CHARACTERS = 'Tem caracteres que não são aceites.';

/** Texto de uma linha: nomes e títulos. */
const lineText = (min: number, max: number, tooShort: string) =>
  z
    .string()
    .trim()
    .min(min, tooShort)
    .max(max, `Máximo ${max} caracteres.`)
    .refine(isSingleLineText, FORBIDDEN_CHARACTERS);

const id = z.guid('Identificador inválido.');
const money = z
  .number()
  .nonnegative('Não pode ser negativo.')
  .max(MAX_MONEY_AMOUNT, `Máximo ${formatEUR(MAX_MONEY_AMOUNT, 2)}.`);
/** NUMERIC(10, 2) */
const taskCost = z.number().nonnegative('Não pode ser negativo.').max(99_999_999.99, 'Máximo 99.999.999,99 €.');
const isoDate = z.string().refine(isValidIsoDate, 'Data inválida (AAAA-MM-DD).');
/** Prazo de uma tarefa. Limitado a um intervalo com sentido: um prazo no ano 9999 saía da validação ao deslizar. */
const deadlineDate = isoDate.refine((value) => value >= '2000-01-01' && value <= '2100-12-31', 'O prazo tem de estar entre 2000 e 2100.');
const share = z.number().min(0, 'Mínimo 0%.').max(100, 'Máximo 100%.');
const nif = z.string().trim().refine(isValidNif, 'NIF inválido.');
const cae = z.string().trim().refine(isValidCae, 'CAE inválido (5 dígitos).');
const companyName = lineText(2, 255, 'Nome demasiado curto.');
const sectorProfile = z.enum(SECTOR_PROFILES);

export const idParamsSchema = z.object({ id });

/** Lacuna de um diagnóstico: /assessments/:id/deliverables/:code */
export const deliverableParamsSchema = z.object({
  id,
  code: z.enum(['ecovadis', 'carbon_scope_1_2', 'carbon_scope_3', 'banking_esg', 'information_security']),
});

// Auth

export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(255).pipe(z.email('Email inválido.')),
  password: z.string().min(1, 'Palavra-passe em falta.').max(200),
  companyId: id.optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.strictObject({
  refreshToken: z.string().min(1).max(4096),
  /** Equipa P4S: muda a empresa selecionada (null limpa). */
  companyId: id.nullable().optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.strictObject({ refreshToken: z.string().min(1).max(4096) });
export type LogoutInput = z.infer<typeof logoutSchema>;

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A palavra-passe tem de ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .refine(
    (value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES,
    `A palavra-passe é demasiado comprida (máximo ${PASSWORD_MAX_BYTES} bytes).`,
  );
const passwordToken = z.string().min(20, 'Link inválido.').max(200, 'Link inválido.');

export const inspectPasswordLinkSchema = z.strictObject({ token: passwordToken });
export type InspectPasswordLinkInput = z.infer<typeof inspectPasswordLinkSchema>;

export const setPasswordSchema = z.strictObject({ token: passwordToken, password });
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1, 'Indique a palavra-passe atual.').max(200),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Utilizadores

const email = z.string().trim().toLowerCase().max(255).pipe(z.email('Email inválido.'));
const fullName = lineText(2, 150, 'Nome demasiado curto.');

export const createUserSchema = z.strictObject({
  email,
  fullName,
  /** Por omissão, utilizador da empresa selecionada. Papéis da equipa P4S só por administradores. */
  role: z.enum(['company_user', ...STAFF_ROLES]).default('company_user'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .strictObject({ fullName: fullName.optional(), isActive: z.boolean().optional() })
  .refine((patch) => patch.fullName !== undefined || patch.isActive !== undefined, {
    message: 'Indique pelo menos um campo a alterar.',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Empresas

export const createCompanySchema = z.strictObject({
  name: companyName,
  nif,
  cae,
  sectorProfile: sectorProfile.default('general_industrial'),
  annualRevenue: money.default(0),
  exportPercentage: share.default(0),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z
  .strictObject({
    name: companyName.optional(),
    nif: nif.optional(),
    cae: cae.optional(),
    sectorProfile: sectorProfile.optional(),
    annualRevenue: money.optional(),
    exportPercentage: share.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'Indique pelo menos um campo a alterar.',
  });
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

/** Criação rápida em reunião: NIF + nome chegam. */
export const quickCompanySchema = z.strictObject({
  name: companyName,
  nif,
  cae: cae.optional(),
  exportPercentage: share.optional(),
});
export type QuickCompanyInput = z.infer<typeof quickCompanySchema>;

// Stress test

const stressTestAnswers = {
  topClientsShare: share,
  creditLineToRefinance: money.default(0),
  ecovadis: z.boolean(),
  carbonFootprintScope12: z.boolean(),
  carbonFootprintScope3: z.boolean(),
  bankingEsgMetrics: z.boolean(),
  tisaxOrNis2: z.boolean(),
};

export const simulateAssessmentSchema = z.strictObject({
  sectorProfile,
  annualRevenue: money,
  ...stressTestAnswers,
});
export type SimulateAssessmentInput = z.infer<typeof simulateAssessmentSchema>;

export const createAssessmentSchema = z.strictObject({
  /** Sem company, usa a empresa da sessão. */
  company: quickCompanySchema.optional(),
  /** Por omissão, o setor e a faturação registados na empresa. */
  sectorProfile: sectorProfile.optional(),
  annualRevenue: money.optional(),
  ...stressTestAnswers,
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

// Tarefas

export const taskListQuerySchema = z.strictObject({
  status: z.enum(TASK_STATUSES).optional(),
  domain: z.enum(TASK_DOMAINS).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  executor_type: z.enum(TASK_EXECUTORS).optional(),
  phase: z.enum(TASK_PHASES).optional(),
  assessment_id: id.optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

const taskFields = {
  title: lineText(3, 255, 'Título demasiado curto.'),
  description: z.string().trim().max(5000, 'Máximo 5000 caracteres.').refine(isPlainText, FORBIDDEN_CHARACTERS).nullable(),
  domain: z.enum(TASK_DOMAINS),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  executorType: z.enum(TASK_EXECUTORS),
  phase: z.enum(TASK_PHASES),
  includedInProposal: z.boolean(),
  estimatedCost: taskCost,
  deadline: deadlineDate.nullable(),
  assignedUserId: id.nullable(),
};

export const createTaskSchema = z.strictObject({
  assessmentId: id,
  title: taskFields.title,
  description: taskFields.description.optional(),
  domain: taskFields.domain,
  priority: taskFields.priority.default('medium'),
  status: taskFields.status.default('backlog'),
  /** Por omissão: p4s para a equipa P4S, internal para a empresa. */
  executorType: taskFields.executorType.optional(),
  phase: taskFields.phase.default('phase_1_urgent'),
  includedInProposal: taskFields.includedInProposal.default(true),
  estimatedCost: taskFields.estimatedCost.default(0),
  deadline: taskFields.deadline.optional(),
  assignedUserId: taskFields.assignedUserId.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .strictObject({
    title: taskFields.title.optional(),
    description: taskFields.description.optional(),
    domain: taskFields.domain.optional(),
    priority: taskFields.priority.optional(),
    status: taskFields.status.optional(),
    executorType: taskFields.executorType.optional(),
    phase: taskFields.phase.optional(),
    includedInProposal: taskFields.includedInProposal.optional(),
    estimatedCost: taskFields.estimatedCost.optional(),
    deadline: taskFields.deadline.optional(),
    assignedUserId: taskFields.assignedUserId.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'Indique pelo menos um campo a alterar.',
  });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
