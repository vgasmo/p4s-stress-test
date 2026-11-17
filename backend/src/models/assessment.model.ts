// Isolamento multi-tenant: todas as leituras filtram por company_id = $1, e o
// company_id vem sempre do contexto autenticado, nunca do corpo do pedido.

import type { Queryable } from '../config/database.js';
import type { Assessment, AssessmentStatus, SectorProfile } from './domain.js';

const COLUMNS = `id, company_id, conducted_by, status, sector_profile, risk_score, revenue_at_risk,
  credit_line_to_refinance, estimated_spread_penalty, raw_responses, proposal_issued_at, completed_at, created_at`;

interface AssessmentRow {
  id: string;
  company_id: string;
  conducted_by: string | null;
  status: AssessmentStatus;
  sector_profile: SectorProfile;
  risk_score: number;
  revenue_at_risk: number;
  credit_line_to_refinance: number;
  estimated_spread_penalty: number;
  raw_responses: Record<string, unknown>;
  proposal_issued_at: Date;
  completed_at: Date | null;
  created_at: Date;
}

const toAssessment = (row: AssessmentRow): Assessment => ({
  id: row.id,
  companyId: row.company_id,
  conductedBy: row.conducted_by,
  status: row.status,
  sectorProfile: row.sector_profile,
  riskScore: row.risk_score,
  revenueAtRisk: row.revenue_at_risk,
  creditLineToRefinance: row.credit_line_to_refinance,
  estimatedSpreadPenalty: row.estimated_spread_penalty,
  rawResponses: row.raw_responses,
  proposalIssuedAt: row.proposal_issued_at.toISOString(),
  completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
});

export interface NewAssessment {
  conductedBy: string;
  sectorProfile: SectorProfile;
  riskScore: number;
  revenueAtRisk: number;
  creditLineToRefinance: number;
  estimatedSpreadPenalty: number;
  rawResponses: Record<string, unknown>;
}

export interface AssessmentListItem extends Assessment {
  conductedByName: string | null;
  taskCount: number;
}

export const assessmentModel = {
  /** Grava uma avaliação já calculada (estado completed). */
  async insertCompleted(db: Queryable, companyId: string, data: NewAssessment): Promise<Assessment> {
    const { rows } = await db.query<AssessmentRow>(
      `INSERT INTO assessments (company_id, conducted_by, status, sector_profile, risk_score, revenue_at_risk,
         credit_line_to_refinance, estimated_spread_penalty, raw_responses, completed_at)
       VALUES ($1, $2, 'completed', $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING ${COLUMNS}`,
      [
        companyId,
        data.conductedBy,
        data.sectorProfile,
        data.riskScore,
        data.revenueAtRisk,
        data.creditLineToRefinance,
        data.estimatedSpreadPenalty,
        JSON.stringify(data.rawResponses),
      ],
    );
    return toAssessment(rows[0] as AssessmentRow);
  },

  async findById(
    db: Queryable,
    companyId: string,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<Assessment | null> {
    const { rows } = await db.query<AssessmentRow>(
      `SELECT ${COLUMNS} FROM assessments WHERE company_id = $1 AND id = $2${options.forUpdate ? ' FOR UPDATE' : ''}`,
      [companyId, id],
    );
    return rows[0] ? toAssessment(rows[0]) : null;
  },

  /** Nome de quem gravou o diagnóstico, para o identificar no plano e no histórico. */
  async conductedByName(db: Queryable, companyId: string, id: string): Promise<string | null> {
    const { rows } = await db.query<{ full_name: string | null }>(
      `SELECT u.full_name FROM assessments a LEFT JOIN users u ON u.id = a.conducted_by
       WHERE a.company_id = $1 AND a.id = $2`,
      [companyId, id],
    );
    return rows[0]?.full_name ?? null;
  },

  /** A proposta passa a contar como emitida agora. */
  async markProposalIssued(db: Queryable, companyId: string, id: string): Promise<Assessment | null> {
    const { rows } = await db.query<AssessmentRow>(
      `UPDATE assessments SET proposal_issued_at = CURRENT_TIMESTAMP WHERE company_id = $1 AND id = $2
       RETURNING ${COLUMNS}`,
      [companyId, id],
    );
    return rows[0] ? toAssessment(rows[0]) : null;
  },

  /** Elimina o diagnóstico e, por cascata, as suas tarefas. */
  async remove(db: Queryable, companyId: string, id: string): Promise<boolean> {
    const { rowCount } = await db.query(`DELETE FROM assessments WHERE company_id = $1 AND id = $2`, [companyId, id]);
    return (rowCount ?? 0) > 0;
  },

  async listByCompany(db: Queryable, companyId: string): Promise<AssessmentListItem[]> {
    const { rows } = await db.query<AssessmentRow & { conducted_by_name: string | null; task_count: string }>(
      `SELECT a.id, a.company_id, a.conducted_by, a.status, a.sector_profile, a.risk_score, a.revenue_at_risk,
              a.credit_line_to_refinance, a.estimated_spread_penalty, a.raw_responses, a.proposal_issued_at,
              a.completed_at, a.created_at,
              u.full_name AS conducted_by_name,
              (SELECT count(*) FROM tasks t WHERE t.company_id = $1 AND t.assessment_id = a.id) AS task_count
       FROM assessments a
       LEFT JOIN users u ON u.id = a.conducted_by
       WHERE a.company_id = $1
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [companyId],
    );
    return rows.map((row) => ({
      ...toAssessment(row),
      conductedByName: row.conducted_by_name,
      taskCount: Number(row.task_count),
    }));
  },
};
