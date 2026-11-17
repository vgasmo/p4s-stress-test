import type pg from 'pg';
import { pool, withTransaction } from '../config/database.js';
import type {
  AssessmentDetail,
  AssessmentListEntry,
  AssessmentSnapshot,
  AssessmentSnapshotView,
  CompanyResolution,
  CompanySummary,
  CreatedAssessment,
  DealbreakerSnapshot,
  FullSimulation,
  ProposalInfo,
  RequirementSnapshot,
  SimulationResponse,
} from '../models/api.types.js';
import { assessmentModel } from '../models/assessment.model.js';
import { companyModel } from '../models/company.model.js';
import {
  PROPOSAL_VALIDITY_DAYS,
  isStaffRole,
  type Assessment,
  type AuthUser,
  type Company,
  type Task,
  type TenantContext,
} from '../models/domain.js';
import type { CreateAssessmentInput, QuickCompanyInput, SimulateAssessmentInput } from '../models/schemas.js';
import { taskModel, type NewTask } from '../models/task.model.js';
import { addDays, daysBetween, todayInLisbon } from '../utils/dates.js';
import { AppError, companyScopeRequired, forbidden, notFound } from '../utils/errors.js';
import { conflict } from '../utils/errors.js';
import { CATALOG } from './catalog.private.js';
import { toPublicSimulation } from './public-simulation.js';
import { summarizeRemediation } from './remediation-summary.js';
import { describeSources, type RequirementCode, type StressTestInput } from './requirements.js';
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

const toNewTask = (draft: GeneratedTaskDraft, createdBy: string): NewTask => ({
  requirementCode: draft.requirementCode,
  origin: 'assessment',
  createdBy,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fotografia do cálculo guardada em raw_responses. Null quando não existe ou está incompleta
 * (rascunhos e diagnósticos anteriores à fase 2): esses não se conseguem abrir.
 */
function readSnapshot(assessment: Assessment): AssessmentSnapshot | null {
  if (assessment.status !== 'completed') return null;
  const raw = assessment.rawResponses;
  if (typeof raw.baseDate !== 'string' || !isRecord(raw.input) || !Array.isArray(raw.requirements)) return null;
  const complete = raw.requirements.every(
    (item) => isRecord(item) && typeof item.code === 'string' && isRecord(item.solution),
  );
  return complete ? (raw as unknown as AssessmentSnapshot) : null;
}

const notOpenable = () =>
  new AppError(
    409,
    'ASSESSMENT_NOT_OPENABLE',
    'Este diagnóstico foi gravado por uma versão anterior e não pode ser aberto. Faça um novo diagnóstico para esta empresa.',
  );

/** A validade conta a partir da data de emissão guardada, e não do dia em que alguém imprime. */
function proposalInfo(assessment: Assessment, today: string = todayInLisbon()): ProposalInfo {
  const issuedOn = todayInLisbon(new Date(assessment.proposalIssuedAt));
  const validUntil = addDays(issuedOn, PROPOSAL_VALIDITY_DAYS);
  return { issuedOn, validUntil, validityDays: PROPOSAL_VALIDITY_DAYS, expired: today > validUntil };
}

/**
 * A fotografia que uma conta de empresa recebe. Leva o que o resumo impresso já lhe dá e
 * deixa de fora o que é do catálogo privado: o peso de cada requisito (e a fonte desse peso),
 * a soma das lacunas e os preços e prazos de catálogo, incluindo os dos entregáveis que não
 * lhe foram propostos. Campo a campo, para nada do que estiver gravado passar por arrasto.
 */
export function snapshotForCompany(snapshot: AssessmentSnapshot): AssessmentSnapshotView {
  return {
    engineVersion: snapshot.engineVersion,
    baseDate: snapshot.baseDate,
    input: snapshot.input,
    exposedClientRevenue: snapshot.exposedClientRevenue,
    commercialGapPoints: null,
    commercialRiskPoints: snapshot.commercialRiskPoints,
    commercialRevenueAtRiskShare: snapshot.commercialRevenueAtRiskShare,
    criticalGapCount: snapshot.criticalGapCount,
    ...(snapshot.spreadPenaltyBps !== undefined ? { spreadPenaltyBps: snapshot.spreadPenaltyBps } : {}),
    dealbreaker: snapshot.dealbreaker && {
      sector: snapshot.dealbreaker.sector,
      floorPoints: snapshot.dealbreaker.floorPoints,
      triggeredBy: snapshot.dealbreaker.triggeredBy,
      reason: snapshot.dealbreaker.reason,
      raisedWeight: snapshot.dealbreaker.raisedWeight,
    },
    requirements: snapshot.requirements.map((requirement) => ({
      code: requirement.code,
      label: requirement.label,
      channel: requirement.channel,
      status: requirement.status,
      weightPoints: null,
      requiredBy: requirement.requiredBy,
      requiredByLabel: requirement.requiredByLabel,
      solution: {
        title: requirement.solution.title,
        executorType: requirement.solution.executorType,
        phase: requirement.solution.phase,
        priority: requirement.solution.priority,
        estimatedCost: null,
        deadlineDays: null,
      },
    })),
  };
}

function buildDetail(
  assessment: Assessment,
  snapshot: AssessmentSnapshotView,
  company: Company,
  tasks: Task[],
  conductedByName: string | null,
): AssessmentDetail {
  return {
    id: assessment.id,
    status: assessment.status,
    sectorProfile: assessment.sectorProfile,
    riskScore: assessment.riskScore,
    commercialRevenueAtRisk: assessment.revenueAtRisk,
    estimatedSpreadPenalty: assessment.estimatedSpreadPenalty,
    creditLineToRefinance: assessment.creditLineToRefinance,
    conductedBy: assessment.conductedBy,
    conductedByName,
    completedAt: assessment.completedAt,
    createdAt: assessment.createdAt,
    company: toCompanySummary(company),
    snapshot,
    proposal: proposalInfo(assessment),
    remediationSummary: summarizeRemediation(tasks, assessment.revenueAtRisk),
    tasks,
  };
}

/**
 * Empresa da avaliação. Por omissão a da sessão (JWT). A equipa P4S pode indicar
 * NIF + nome para criar a empresa na hora. Se o NIF já existir, usa a empresa que lá está
 * tal como está, e a resposta diz que foi isso que aconteceu.
 */
async function resolveCompany(
  client: pg.PoolClient,
  auth: AuthUser,
  quick: QuickCompanyInput | undefined,
  payload: CreateAssessmentInput,
): Promise<{ company: Company; resolution: CompanyResolution }> {
  if (quick) {
    const created = await companyModel.insertIfAbsent(client, {
      name: quick.name,
      nif: quick.nif,
      cae: quick.cae ?? '',
      sectorProfile: payload.sectorProfile ?? 'general_industrial',
      annualRevenue: payload.annualRevenue ?? 0,
      exportPercentage: quick.exportPercentage ?? 0,
    });
    if (created) return { company: created, resolution: 'created' };
    const existing = await companyModel.findByNif(client, quick.nif);
    if (!existing) throw notFound('Empresa não encontrada.');
    return { company: existing, resolution: 'existing' };
  }
  if (!auth.companyId) throw companyScopeRequired();
  const company = await companyModel.findById(client, auth.companyId);
  if (!company) throw notFound('Empresa não encontrada.');
  return { company, resolution: 'session' };
}

const assertStaff = (role: AuthUser['role'], message: string): void => {
  if (!isStaffRole(role)) throw forbidden(message);
};

export const assessmentService = {
  /**
   * Diagnóstico em memória, sem gravar nada. A equipa P4S recebe o cálculo completo.
   * Os outros (sem sessão ou com conta de empresa) recebem só ordens de grandeza, sem pesos
   * nem preços.
   */
  simulate(input: SimulateAssessmentInput, fullAccess: boolean): SimulationResponse {
    const result = calculator.calculate(input);
    return fullAccess ? toFullSimulation(result, todayInLisbon()) : toPublicSimulation(input, result, CATALOG);
  },

  /**
   * Calcula, grava a avaliação e insere as tarefas numa única transação. Só a equipa P4S:
   * um diagnóstico gravado gera entregáveis com preço e é a base de uma proposta.
   */
  async create(auth: AuthUser, payload: CreateAssessmentInput): Promise<CreatedAssessment> {
    assertStaff(auth.role, 'Só a equipa P4S grava diagnósticos. Peça um novo diagnóstico ao seu consultor.');
    return withTransaction(async (client) => {
      const resolved = await resolveCompany(client, auth, payload.company, payload);
      const { resolution } = resolved;
      let { company } = resolved;

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

      // A ficha da empresa acompanha o último diagnóstico: é dela que parte o seguinte.
      if (input.sectorProfile !== company.sectorProfile || input.annualRevenue !== company.annualRevenue) {
        company =
          (await companyModel.update(client, company.id, {
            sectorProfile: input.sectorProfile,
            annualRevenue: input.annualRevenue,
          })) ?? company;
      }

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

      const drafts = generator.generate(result.gaps, baseDate).map((draft) => toNewTask(draft, auth.userId));
      await taskModel.insertBatch(client, company.id, assessment.id, drafts);
      const tasks = await taskModel.list(client, company.id, { assessmentId: assessment.id });

      const author = await assessmentModel.conductedByName(client, company.id, assessment.id);
      return { ...buildDetail(assessment, snapshot, company, tasks, author), companyResolution: resolution };
    });
  },

  async get(ctx: TenantContext, id: string): Promise<AssessmentDetail> {
    const assessment = await assessmentModel.findById(pool, ctx.companyId, id);
    if (!assessment) throw notFound('Avaliação não encontrada.');
    const snapshot = readSnapshot(assessment);
    if (!snapshot) throw notOpenable();
    const company = await companyModel.findById(pool, ctx.companyId);
    if (!company) throw notFound('Empresa não encontrada.');
    const tasks = await taskModel.list(pool, ctx.companyId, { assessmentId: assessment.id });
    const author = await assessmentModel.conductedByName(pool, ctx.companyId, assessment.id);
    const visible = isStaffRole(ctx.role) ? snapshot : snapshotForCompany(snapshot);
    return buildDetail(assessment, visible, company, tasks, author);
  },

  /**
   * Repõe o entregável-tipo de uma lacuna que ficou sem resposta no plano (foi eliminado),
   * com os termos da fotografia do diagnóstico. O prazo conta da data de emissão da proposta.
   */
  async restoreDeliverable(ctx: TenantContext, id: string, code: RequirementCode): Promise<Task> {
    assertStaff(ctx.role, 'Só a equipa P4S repõe entregáveis.');
    return withTransaction(async (client) => {
      const assessment = await assessmentModel.findById(client, ctx.companyId, id, { forUpdate: true });
      if (!assessment) throw notFound('Avaliação não encontrada.');
      const snapshot = readSnapshot(assessment);
      if (!snapshot) throw notOpenable();
      const requirement = snapshot.requirements.find((entry) => entry.code === code && entry.status === 'gap');
      if (!requirement) throw notFound('Este diagnóstico não tem essa lacuna.');
      if (await taskModel.findByRequirement(client, ctx.companyId, id, code)) {
        throw conflict('O entregável desta lacuna já está no plano.');
      }

      const { solution } = requirement;
      const template = CATALOG.parameters[code].task;
      return taskModel.insert(client, ctx.companyId, id, {
        title: solution.title,
        description: template.description,
        domain: template.domain,
        priority: solution.priority,
        status: 'backlog',
        executorType: solution.executorType,
        phase: solution.phase,
        includedInProposal: true,
        estimatedCost: solution.estimatedCost,
        deadline: addDays(proposalInfo(assessment).issuedOn, solution.deadlineDays),
        assignedUserId: null,
        requirementCode: code,
        origin: 'assessment',
        createdBy: ctx.userId,
      });
    });
  },

  /**
   * Reemite a proposta com a data de hoje. Os entregáveis da P4S e do parceiro por concluir
   * deslizam os mesmos dias, para manterem a duração prometida.
   */
  async reissueProposal(ctx: TenantContext, id: string): Promise<AssessmentDetail> {
    assertStaff(ctx.role, 'Só a equipa P4S reemite propostas.');
    return withTransaction(async (client) => {
      const current = await assessmentModel.findById(client, ctx.companyId, id, { forUpdate: true });
      if (!current) throw notFound('Avaliação não encontrada.');
      const snapshot = readSnapshot(current);
      if (!snapshot) throw notOpenable();
      const company = await companyModel.findById(client, ctx.companyId);
      if (!company) throw notFound('Empresa não encontrada.');

      const shift = daysBetween(todayInLisbon(new Date(current.proposalIssuedAt)), todayInLisbon());
      const reissued = await assessmentModel.markProposalIssued(client, ctx.companyId, id);
      if (!reissued) throw notFound('Avaliação não encontrada.');
      if (shift > 0) await taskModel.shiftPendingDeliverables(client, ctx.companyId, id, shift);

      const tasks = await taskModel.list(client, ctx.companyId, { assessmentId: id });
      const author = await assessmentModel.conductedByName(client, ctx.companyId, id);
      return buildDetail(reissued, snapshot, company, tasks, author);
    });
  },

  /** Elimina um diagnóstico (de teste ou enganado) e as suas tarefas. */
  async remove(ctx: TenantContext, id: string): Promise<void> {
    assertStaff(ctx.role, 'Só a equipa P4S pode eliminar diagnósticos.');
    const removed = await assessmentModel.remove(pool, ctx.companyId, id);
    if (!removed) throw notFound('Avaliação não encontrada.');
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
      openable: readSnapshot(row) !== null,
      proposal: proposalInfo(row),
      conductedByName: row.conductedByName,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    }));
  },
};
