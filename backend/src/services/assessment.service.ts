import type pg from 'pg';
import { pool, withTransaction } from '../config/database.js';
import type {
  AssessmentDetail,
  AssessmentListEntry,
  AssessmentSnapshot,
  CompanySummary,
  DealbreakerSnapshot,
  FullSimulation,
  RequirementSnapshot,
  SimulationResponse,
} from '../models/api.types.js';
import { assessmentModel } from '../models/assessment.model.js';
import { companyModel } from '../models/company.model.js';
import {
  isStaffRole,
  type Assessment,
  type AuthUser,
  type Company,
  type Task,
  type TenantContext,
} from '../models/domain.js';
import type { CreateAssessmentInput, QuickCompanyInput, SimulateAssessmentInput } from '../models/schemas.js';
import { taskModel, type NewTask } from '../models/task.model.js';
import { todayInLisbon } from '../utils/dates.js';
import { companyScopeRequired, forbidden, notFound } from '../utils/errors.js';
import { CATALOG } from './catalog.private.js';
import { toPublicSimulation } from './public-simulation.js';
import { summarizeRemediation } from './remediation-summary.js';
import { describeSources, type StressTestInput } from './requirements.js';
import { StressTestCalculatorService, type StressTestResult } from './stress-test-calculator.service.js';
import { TaskGeneratorService, type GeneratedTaskDraft } from './task-generator.service.js';

const calculator = new StressTestCalculatorService(CATALOG);
const generator = new TaskGeneratorService();

function snapshotRequirements(result: StressTestResult): RequirementSnapshot[] {
  return result.evaluations.map(({ requirement, status, weightPoints, task }) => ({
    code: requirement.code,
    label: requirement.label,
    channel: requirement.channel,
    status,
    weightPoints,
    ...(CATALOG.parameters[requirement.code].evidence
      ? { evidence: CATALOG.parameters[requirement.code].evidence }
      : {}),
    requiredBy: [...requirement.requiredBy],
    requiredByLabel: describeSources(requirement.requiredBy),
    solution: {
      title: task.title,
      executorType: task.executorType,
      phase: task.phase,
      priority: task.priority,
      estimatedCost: task.estimatedCost,
      deadlineDays: task.deadlineDays,
    },
  }));
}

function snapshotDealbreaker(result: StressTestResult): DealbreakerSnapshot | null {
  const { dealbreaker } = result;
  if (!dealbreaker) return null;
  return {
    sector: dealbreaker.sector,
    floorPoints: dealbreaker.floorPoints,
    triggeredBy: [...dealbreaker.triggeredBy],
    reason: dealbreaker.reason,
    raisedWeight: dealbreaker.raisedWeight,
  };
}

function toFullSimulation(result: StressTestResult, baseDate: string): FullSimulation {
  return {
    access: 'full',
    engineVersion: result.catalogVersion,
    sectorProfile: result.sectorProfile,
    riskScore: result.riskScore,
    commercialRevenueAtRisk: result.commercialRevenueAtRisk,
    commercialRevenueAtRiskShare: result.commercialRevenueAtRiskShare,
    estimatedSpreadPenalty: result.estimatedSpreadPenalty,
    exposedClientRevenue: result.exposedClientRevenue,
    criticalGapCount: result.criticalGapCount,
    dealbreaker: snapshotDealbreaker(result),
    requirements: snapshotRequirements(result),
    remediationSummary: result.remediationSummary,
    suggestedTasks: generator.generate(result.gaps, baseDate),
  };
}

const toNewTask = (draft: GeneratedTaskDraft): NewTask => ({
  title: draft.title,
  description: draft.description,
  domain: draft.domain,
  priority: draft.priority,
  status: draft.status,
  executorType: draft.executorType,
  phase: draft.phase,
  includedInProposal: draft.includedInProposal,
  estimatedCost: draft.estimatedCost,
  deadline: draft.deadline,
  assignedUserId: null,
});

const toCompanySummary = (company: Company): CompanySummary => ({
  id: company.id,
  name: company.name,
  nif: company.nif,
  cae: company.cae,
  sectorProfile: company.sectorProfile,
  annualRevenue: company.annualRevenue,
  exportPercentage: company.exportPercentage,
});

function buildDetail(assessment: Assessment, company: Company, tasks: Task[]): AssessmentDetail {
  return {
    id: assessment.id,
    status: assessment.status,
    sectorProfile: assessment.sectorProfile,
    riskScore: assessment.riskScore,
    commercialRevenueAtRisk: assessment.revenueAtRisk,
    estimatedSpreadPenalty: assessment.estimatedSpreadPenalty,
    creditLineToRefinance: assessment.creditLineToRefinance,
    conductedBy: assessment.conductedBy,
    completedAt: assessment.completedAt,
    createdAt: assessment.createdAt,
    company: toCompanySummary(company),
    snapshot: assessment.rawResponses as unknown as AssessmentSnapshot,
    remediationSummary: summarizeRemediation(tasks, assessment.revenueAtRisk),
    tasks,
  };
}

/**
 * Empresa da avaliação. Por omissão a da sessão (JWT). A equipa P4S pode indicar
 * NIF + nome para criar a empresa na hora (ou reutilizar a que já tem esse NIF).
 */
async function resolveCompany(
  client: pg.PoolClient,
  auth: AuthUser,
  quick: QuickCompanyInput | undefined,
  payload: CreateAssessmentInput,
): Promise<Company> {
  if (quick) {
    if (!isStaffRole(auth.role)) throw forbidden('Só a equipa P4S pode registar empresas.');
    const existing = await companyModel.findByNif(client, quick.nif);
    if (existing) return existing;
    return companyModel.insert(client, {
      name: quick.name,
      nif: quick.nif,
      cae: quick.cae ?? '',
      sectorProfile: payload.sectorProfile ?? 'general_industrial',
      annualRevenue: payload.annualRevenue ?? 0,
      exportPercentage: quick.exportPercentage ?? 0,
    });
  }
  if (!auth.companyId) throw companyScopeRequired();
  const company = await companyModel.findById(client, auth.companyId);
  if (!company) throw notFound('Empresa não encontrada.');
  return company;
}

export const assessmentService = {
  /**
   * Diagnóstico em memória, sem gravar nada. Com sessão devolve o cálculo completo.
   * Sem sessão devolve só ordens de grandeza, sem pesos nem preços.
   */
  simulate(input: SimulateAssessmentInput, authenticated: boolean): SimulationResponse {
    const result = calculator.calculate(input);
    return authenticated ? toFullSimulation(result, todayInLisbon()) : toPublicSimulation(input, result, CATALOG);
  },

  /** Calcula, grava a avaliação e insere as tarefas numa única transação. */
  async create(auth: AuthUser, payload: CreateAssessmentInput): Promise<AssessmentDetail> {
    return withTransaction(async (client) => {
      const company = await resolveCompany(client, auth, payload.company, payload);

      const input: StressTestInput = {
        sectorProfile: payload.sectorProfile ?? company.sectorProfile,
        annualRevenue: payload.annualRevenue ?? company.annualRevenue,
        topClientsShare: payload.topClientsShare,
        creditLineToRefinance: payload.creditLineToRefinance,
        ecovadis: payload.ecovadis,
        carbonFootprintScope12: payload.carbonFootprintScope12,
        carbonFootprintScope3: payload.carbonFootprintScope3,
        bankingEsgMetrics: payload.bankingEsgMetrics,
        tisaxOrNis2: payload.tisaxOrNis2,
      };
      const result = calculator.calculate(input);
      const baseDate = todayInLisbon();

      const snapshot: AssessmentSnapshot = {
        engineVersion: result.catalogVersion,
        baseDate,
        input,
        exposedClientRevenue: result.exposedClientRevenue,
        commercialGapPoints: result.commercialGapPoints,
        commercialRiskPoints: result.commercialRiskPoints,
        commercialRevenueAtRiskShare: result.commercialRevenueAtRiskShare,
        criticalGapCount: result.criticalGapCount,
        spreadPenaltyBps: CATALOG.spreadPenaltyBps,
        dealbreaker: snapshotDealbreaker(result),
        requirements: snapshotRequirements(result),
      };

      const assessment = await assessmentModel.insertCompleted(client, company.id, {
        conductedBy: auth.userId,
        sectorProfile: input.sectorProfile,
        riskScore: result.riskScore,
        revenueAtRisk: result.commercialRevenueAtRisk,
        creditLineToRefinance: input.creditLineToRefinance,
        estimatedSpreadPenalty: result.estimatedSpreadPenalty,
        rawResponses: snapshot as unknown as Record<string, unknown>,
      });

      const drafts = generator.generate(result.gaps, baseDate).map(toNewTask);
      await taskModel.insertBatch(client, company.id, assessment.id, drafts);
      const tasks = await taskModel.list(client, company.id, { assessmentId: assessment.id });

      return buildDetail(assessment, company, tasks);
    });
  },

  async get(ctx: TenantContext, id: string): Promise<AssessmentDetail> {
    const assessment = await assessmentModel.findById(pool, ctx.companyId, id);
    if (!assessment) throw notFound('Avaliação não encontrada.');
    const company = await companyModel.findById(pool, ctx.companyId);
    if (!company) throw notFound('Empresa não encontrada.');
    const tasks = await taskModel.list(pool, ctx.companyId, { assessmentId: assessment.id });
    return buildDetail(assessment, company, tasks);
  },

  async list(ctx: TenantContext): Promise<AssessmentListEntry[]> {
    const rows = await assessmentModel.listByCompany(pool, ctx.companyId);
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      sectorProfile: row.sectorProfile,
      riskScore: row.riskScore,
      commercialRevenueAtRisk: row.revenueAtRisk,
      estimatedSpreadPenalty: row.estimatedSpreadPenalty,
      taskCount: row.taskCount,
      conductedByName: row.conductedByName,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    }));
  },
};
