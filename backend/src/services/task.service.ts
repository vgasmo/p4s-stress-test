// CRUD de tarefas com isolamento por empresa e RBAC.
//
// Regras para company_user (utilizador da fábrica):
//   - não elimina tarefas (a rota DELETE só aceita a equipa P4S);
//   - nas tarefas que não criou (as do diagnóstico e as criadas pela P4S) só atualiza o estado
//     e o responsável. Âmbito, prazo, preço, executor, fase e inclusão na proposta são da P4S,
//     seja qual for o executor do momento: passar um entregável a «Interno» e voltar atrás
//     não deixa a empresa mexer nos termos;
//   - nas tarefas que criou, sempre internas, altera tudo menos o executor.
// Quando a equipa P4S passa uma tarefa da empresa para a P4S ou para o parceiro, assume-a:
// a partir daí a empresa só a acompanha.

import { pool, withTransaction, type Queryable } from '../config/database.js';
import { assessmentModel } from '../models/assessment.model.js';
import {
  COMPANY_FOLLOW_UP_FIELDS,
  isPricedExecutor,
  isStaffRole,
  type Task,
  type TenantContext,
} from '../models/domain.js';
import type { CreateTaskInput, TaskListQuery, UpdateTaskInput } from '../models/schemas.js';
import { taskModel, type TaskFields, type TaskPatch } from '../models/task.model.js';
import { userModel } from '../models/user.model.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';

const FOLLOW_UP_FIELDS: readonly string[] = COMPANY_FOLLOW_UP_FIELDS;

async function assertAssignable(db: Queryable, companyId: string, userId: string): Promise<void> {
  const user = await userModel.findById(db, userId);
  const belongs = user?.companyId === companyId || (user !== null && isStaffRole(user.role));
  if (!user || !user.isActive || !belongs) throw badRequest('Responsável inválido para esta empresa.');
}

function assertCompanyUserCanPatch(current: Task, patch: TaskPatch): void {
  if (current.origin !== 'company') {
    const changed = (Object.keys(patch) as (keyof TaskFields)[]).filter(
      (field) => !FOLLOW_UP_FIELDS.includes(field) && patch[field] !== current[field],
    );
    if (changed.length > 0) {
      throw forbidden(
        'Esta tarefa foi definida pela P4S. Pode atualizar o estado e o responsável. O resto só a P4S altera.',
      );
    }
    return;
  }
  if (patch.executorType !== undefined && isPricedExecutor(patch.executorType)) {
    throw forbidden('Só a P4S pode atribuir tarefas à P4S ou ao parceiro.');
  }
}

const toPatch = (input: UpdateTaskInput): TaskPatch => {
  const patch: TaskPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  return patch;
};

export const taskService = {
  async list(ctx: TenantContext, query: TaskListQuery): Promise<Task[]> {
    return taskModel.list(pool, ctx.companyId, {
      status: query.status,
      domain: query.domain,
      priority: query.priority,
      executorType: query.executor_type,
      phase: query.phase,
      assessmentId: query.assessment_id,
    });
  },

  async get(ctx: TenantContext, id: string): Promise<Task> {
    const task = await taskModel.findById(pool, ctx.companyId, id);
    if (!task) throw notFound('Tarefa não encontrada.');
    return task;
  },

  async create(ctx: TenantContext, input: CreateTaskInput): Promise<Task> {
    const staff = isStaffRole(ctx.role);
    const executorType = input.executorType ?? (staff ? 'p4s' : 'internal');
    if (!staff && isPricedExecutor(executorType)) {
      throw forbidden('Utilizadores da empresa só podem criar tarefas internas.');
    }

    const assessment = await assessmentModel.findById(pool, ctx.companyId, input.assessmentId);
    if (!assessment) throw notFound('Avaliação não encontrada.');
    if (input.assignedUserId) await assertAssignable(pool, ctx.companyId, input.assignedUserId);

    return taskModel.insert(pool, ctx.companyId, assessment.id, {
      title: input.title,
      description: input.description ?? null,
      domain: input.domain,
      priority: input.priority,
      status: input.status,
      executorType,
      phase: input.phase,
      includedInProposal: input.includedInProposal,
      estimatedCost: input.estimatedCost,
      deadline: input.deadline ?? null,
      assignedUserId: input.assignedUserId ?? null,
      requirementCode: null,
      origin: staff ? 'p4s' : 'company',
      createdBy: ctx.userId,
    });
  },

  async update(ctx: TenantContext, id: string, input: UpdateTaskInput): Promise<Task> {
    const patch = toPatch(input);
    return withTransaction(async (client) => {
      const current = await taskModel.findById(client, ctx.companyId, id, { forUpdate: true });
      if (!current) throw notFound('Tarefa não encontrada.');

      if (!isStaffRole(ctx.role)) {
        assertCompanyUserCanPatch(current, patch);
      } else if (
        current.origin === 'company' &&
        patch.executorType !== undefined &&
        isPricedExecutor(patch.executorType)
      ) {
        // A P4S assume uma tarefa criada pela empresa: os termos deixam de ser editáveis por ela.
        patch.origin = 'p4s';
      }
      if (patch.assignedUserId) await assertAssignable(client, ctx.companyId, patch.assignedUserId);

      const updated = await taskModel.update(client, ctx.companyId, id, patch, ctx.userId);
      if (!updated) throw notFound('Tarefa não encontrada.');
      return updated;
    });
  },

  async remove(ctx: TenantContext, id: string): Promise<void> {
    // A rota já exige equipa P4S. Verificação repetida aqui por defesa em profundidade.
    if (!isStaffRole(ctx.role)) throw forbidden('Só a equipa P4S pode eliminar tarefas.');
    const removed = await taskModel.remove(pool, ctx.companyId, id);
    if (!removed) throw notFound('Tarefa não encontrada.');
  },
};
