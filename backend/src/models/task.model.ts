// Isolamento multi-tenant: todas as queries filtram por company_id = $1, e o
// company_id vem sempre do contexto autenticado, nunca do corpo do pedido.

import type { Queryable } from '../config/database.js';
import type {
  Task,
  TaskDomain,
  TaskExecutor,
  TaskPhase,
  TaskPriority,
  TaskStatus,
} from './domain.js';

const COLUMNS = `id, assessment_id, company_id, title, description, domain, priority, status, executor_type,
  phase, included_in_proposal, estimated_cost, deadline, assigned_user_id, created_at, updated_at`;

// Os enums ordenam pela ordem de declaração: fase 1 antes da 2, critical antes de low.
const ORDER_BY = 'ORDER BY phase, priority, deadline NULLS LAST, created_at, id';

interface TaskRow {
  id: string;
  assessment_id: string;
  company_id: string;
  title: string;
  description: string | null;
  domain: TaskDomain;
  priority: TaskPriority;
  status: TaskStatus;
  executor_type: TaskExecutor;
  phase: TaskPhase;
  included_in_proposal: boolean;
  estimated_cost: number;
  deadline: string | null;
  assigned_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  assessmentId: row.assessment_id,
  companyId: row.company_id,
  title: row.title,
  description: row.description,
  domain: row.domain,
  priority: row.priority,
  status: row.status,
  executorType: row.executor_type,
  phase: row.phase,
  includedInProposal: row.included_in_proposal,
  estimatedCost: row.estimated_cost,
  deadline: row.deadline,
  assignedUserId: row.assigned_user_id,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export interface NewTask {
  title: string;
  description: string | null;
  domain: TaskDomain;
  priority: TaskPriority;
  status: TaskStatus;
  executorType: TaskExecutor;
  phase: TaskPhase;
  includedInProposal: boolean;
  estimatedCost: number;
  deadline: string | null;
  assignedUserId: string | null;
}

export type TaskPatch = Partial<NewTask>;

export interface TaskFilters {
  status?: TaskStatus | undefined;
  domain?: TaskDomain | undefined;
  priority?: TaskPriority | undefined;
  executorType?: TaskExecutor | undefined;
  phase?: TaskPhase | undefined;
  assessmentId?: string | undefined;
}

const INSERT_COLUMNS = [
  'company_id',
  'assessment_id',
  'title',
  'description',
  'domain',
  'priority',
  'status',
  'executor_type',
  'phase',
  'included_in_proposal',
  'estimated_cost',
  'deadline',
  'assigned_user_id',
] as const;

const PATCH_COLUMNS: Record<keyof TaskPatch, string> = {
  title: 'title',
  description: 'description',
  domain: 'domain',
  priority: 'priority',
  status: 'status',
  executorType: 'executor_type',
  phase: 'phase',
  includedInProposal: 'included_in_proposal',
  estimatedCost: 'estimated_cost',
  deadline: 'deadline',
  assignedUserId: 'assigned_user_id',
};

const rowValues = (companyId: string, assessmentId: string, task: NewTask): unknown[] => [
  companyId,
  assessmentId,
  task.title,
  task.description,
  task.domain,
  task.priority,
  task.status,
  task.executorType,
  task.phase,
  task.includedInProposal,
  task.estimatedCost,
  task.deadline,
  task.assignedUserId,
];

export const taskModel = {
  /** Insere várias tarefas num único INSERT (usado dentro da transação do diagnóstico). */
  async insertBatch(db: Queryable, companyId: string, assessmentId: string, tasks: readonly NewTask[]): Promise<Task[]> {
    if (tasks.length === 0) return [];
    const width = INSERT_COLUMNS.length;
    const values: unknown[] = [];
    const tuples = tasks.map((task, index) => {
      values.push(...rowValues(companyId, assessmentId, task));
      const placeholders = Array.from({ length: width }, (_, column) => `$${index * width + column + 1}`);
      return `(${placeholders.join(', ')})`;
    });
    const { rows } = await db.query<TaskRow>(
      `INSERT INTO tasks (${INSERT_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')} RETURNING ${COLUMNS}`,
      values,
    );
    return rows.map(toTask);
  },

  async insert(db: Queryable, companyId: string, assessmentId: string, task: NewTask): Promise<Task> {
    const [created] = await taskModel.insertBatch(db, companyId, assessmentId, [task]);
    return created as Task;
  },

  async list(db: Queryable, companyId: string, filters: TaskFilters = {}): Promise<Task[]> {
    const filtersSql: string[] = [];
    const values: unknown[] = [companyId];
    const add = (column: string, value: unknown) => {
      if (value === undefined) return;
      values.push(value);
      filtersSql.push(` AND ${column} = $${values.length}`);
    };
    add('status', filters.status);
    add('domain', filters.domain);
    add('priority', filters.priority);
    add('executor_type', filters.executorType);
    add('phase', filters.phase);
    add('assessment_id', filters.assessmentId);

    const { rows } = await db.query<TaskRow>(
      `SELECT ${COLUMNS} FROM tasks WHERE company_id = $1${filtersSql.join('')} ${ORDER_BY}`,
      values,
    );
    return rows.map(toTask);
  },

  async findById(db: Queryable, companyId: string, id: string, options: { forUpdate?: boolean } = {}): Promise<Task | null> {
    const { rows } = await db.query<TaskRow>(
      `SELECT ${COLUMNS} FROM tasks WHERE company_id = $1 AND id = $2${options.forUpdate ? ' FOR UPDATE' : ''}`,
      [companyId, id],
    );
    return rows[0] ? toTask(rows[0]) : null;
  },

  async update(db: Queryable, companyId: string, id: string, patch: TaskPatch): Promise<Task | null> {
    const sets: string[] = [];
    const values: unknown[] = [companyId, id];
    for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof TaskPatch, string][]) {
      const value = patch[key];
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) return taskModel.findById(db, companyId, id);
    sets.push('updated_at = CURRENT_TIMESTAMP');

    const { rows } = await db.query<TaskRow>(
      `UPDATE tasks SET ${sets.join(', ')} WHERE company_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      values,
    );
    return rows[0] ? toTask(rows[0]) : null;
  },

  async remove(db: Queryable, companyId: string, id: string): Promise<boolean> {
    const { rowCount } = await db.query(`DELETE FROM tasks WHERE company_id = $1 AND id = $2`, [companyId, id]);
    return (rowCount ?? 0) > 0;
  },
};
