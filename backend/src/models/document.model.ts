// Documentos analisados e exigências extraídas. Como em assessments e tasks, todas as leituras
// e alterações filtram por company_id = $1, e o company_id vem sempre da sessão.

import type { Queryable } from '../config/database.js';
import type {
  DocumentAnalysisStatus,
  DocumentAnalysisSummary,
  DocumentFileKind,
  DocumentFinding,
  FindingObligation,
  FindingReviewStatus,
  RequirementEvidence,
} from './api.types.js';
import type { RequirementCode } from '../services/requirements.js';

/** Uma análise «em curso» há mais tempo do que isto foi interrompida (o servidor reiniciou a meio). */
export const STALE_ANALYSIS_MINUTES = 30;

const ANALYSIS_COLUMNS = `a.id, a.file_name, a.file_kind, a.file_size, a.page_count, a.status, a.failure_code,
  a.failure_message, a.issuer, a.document_type, a.document_language, a.document_date, a.summary, a.model,
  a.created_at, a.completed_at, u.full_name AS uploaded_by_name,
  COUNT(f.id)::int AS findings_total,
  COUNT(f.id) FILTER (WHERE f.review_status = 'pending')::int AS findings_pending,
  COUNT(f.id) FILTER (WHERE f.review_status = 'confirmed')::int AS findings_confirmed,
  COUNT(f.id) FILTER (WHERE f.review_status = 'rejected')::int AS findings_rejected,
  COUNT(f.id) FILTER (WHERE NOT f.quote_verified)::int AS findings_unverified`;

interface AnalysisRow {
  id: string;
  file_name: string;
  file_kind: DocumentFileKind;
  file_size: number;
  page_count: number | null;
  status: DocumentAnalysisStatus;
  failure_code: string | null;
  failure_message: string | null;
  issuer: string | null;
  document_type: string | null;
  document_language: string | null;
  document_date: string | null;
  summary: string | null;
  model: string | null;
  created_at: Date;
  completed_at: Date | null;
  uploaded_by_name: string | null;
  findings_total: number;
  findings_pending: number;
  findings_confirmed: number;
  findings_rejected: number;
  findings_unverified: number;
}

const toSummary = (row: AnalysisRow): DocumentAnalysisSummary => ({
  id: row.id,
  fileName: row.file_name,
  fileKind: row.file_kind,
  fileSize: row.file_size,
  pageCount: row.page_count,
  status: row.status,
  failureCode: row.failure_code,
  failureMessage: row.failure_message,
  issuer: row.issuer,
  documentType: row.document_type,
  documentLanguage: row.document_language,
  documentDate: row.document_date,
  summary: row.summary,
  model: row.model,
  uploadedByName: row.uploaded_by_name,
  createdAt: row.created_at.toISOString(),
  completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  findingCounts: {
    total: row.findings_total,
    pending: row.findings_pending,
    confirmed: row.findings_confirmed,
    rejected: row.findings_rejected,
    unverified: row.findings_unverified,
  },
});

const FINDING_COLUMNS = `f.id, f.position, f.requirement_code, f.suggested_requirement_code, f.topic, f.request,
  f.obligation, f.deadline, f.deadline_text, f.consequence, f.quote, f.quote_verified, f.quote_page,
  f.review_status, f.reviewed_at, r.full_name AS reviewed_by_name`;

interface FindingRow {
  id: string;
  position: number;
  requirement_code: RequirementCode | null;
  suggested_requirement_code: RequirementCode | null;
  topic: string;
  request: string;
  obligation: FindingObligation;
  deadline: string | null;
  deadline_text: string | null;
  consequence: string | null;
  quote: string;
  quote_verified: boolean;
  quote_page: number | null;
  review_status: FindingReviewStatus;
  reviewed_at: Date | null;
  reviewed_by_name: string | null;
}

const toFinding = (row: FindingRow): DocumentFinding => ({
  id: row.id,
  position: row.position,
  requirementCode: row.requirement_code,
  suggestedRequirementCode: row.suggested_requirement_code,
  topic: row.topic,
  request: row.request,
  obligation: row.obligation,
  deadline: row.deadline,
  deadlineText: row.deadline_text,
  consequence: row.consequence,
  quote: row.quote,
  quoteVerified: row.quote_verified,
  quotePage: row.quote_page,
  reviewStatus: row.review_status,
  reviewedByName: row.reviewed_by_name,
  reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
});

export interface NewAnalysis {
  uploadedBy: string;
  fileName: string;
  fileKind: DocumentFileKind;
  fileSize: number;
  fileSha256: string;
  pageCount: number | null;
  charCount: number;
}

export interface NewFinding {
  requirementCode: RequirementCode | null;
  topic: string;
  request: string;
  obligation: FindingObligation;
  deadline: string | null;
  deadlineText: string | null;
  consequence: string | null;
  quote: string;
  quoteVerified: boolean;
  quotePage: number | null;
}

export interface AnalysisResult {
  issuer: string | null;
  documentType: string | null;
  documentLanguage: string | null;
  documentDate: string | null;
  summary: string;
  model: string;
}

export interface FindingReview {
  reviewStatus?: FindingReviewStatus | undefined;
  requirementCode?: RequirementCode | null | undefined;
}

export const documentModel = {
  /** Dá como falhadas as análises que ficaram «em curso» porque o servidor parou a meio. */
  async failStale(db: Queryable, companyId: string): Promise<void> {
    await db.query(
      `UPDATE document_analyses
       SET status = 'failed', failure_code = 'INTERRUPTED', completed_at = CURRENT_TIMESTAMP,
           failure_message = 'A análise foi interrompida antes de terminar. Carregue o documento de novo.'
       WHERE company_id = $1 AND status = 'processing'
         AND created_at < CURRENT_TIMESTAMP - make_interval(mins => $2)`,
      [companyId, STALE_ANALYSIS_MINUTES],
    );
  },

  async list(db: Queryable, companyId: string): Promise<DocumentAnalysisSummary[]> {
    const { rows } = await db.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLUMNS}
       FROM document_analyses a
       LEFT JOIN users u ON u.id = a.uploaded_by
       LEFT JOIN document_findings f ON f.analysis_id = a.id
       WHERE a.company_id = $1
       GROUP BY a.id, u.full_name
       ORDER BY a.created_at DESC, a.id`,
      [companyId],
    );
    return rows.map(toSummary);
  },

  async findById(db: Queryable, companyId: string, id: string): Promise<DocumentAnalysisSummary | null> {
    const { rows } = await db.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLUMNS}
       FROM document_analyses a
       LEFT JOIN users u ON u.id = a.uploaded_by
       LEFT JOIN document_findings f ON f.analysis_id = a.id
       WHERE a.company_id = $1 AND a.id = $2
       GROUP BY a.id, u.full_name`,
      [companyId, id],
    );
    return rows[0] ? toSummary(rows[0]) : null;
  },

  /** O mesmo ficheiro já analisado (ou em análise) para esta empresa. */
  async findActiveBySha(db: Queryable, companyId: string, sha256: string): Promise<{ id: string; fileName: string } | null> {
    const { rows } = await db.query<{ id: string; file_name: string }>(
      `SELECT id, file_name FROM document_analyses
       WHERE company_id = $1 AND file_sha256 = $2 AND status <> 'failed'`,
      [companyId, sha256],
    );
    return rows[0] ? { id: rows[0].id, fileName: rows[0].file_name } : null;
  },

  async insert(db: Queryable, companyId: string, data: NewAnalysis): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO document_analyses (company_id, uploaded_by, file_name, file_kind, file_size, file_sha256, page_count, char_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [companyId, data.uploadedBy, data.fileName, data.fileKind, data.fileSize, data.fileSha256, data.pageCount, data.charCount],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('A análise não foi criada.');
    return id;
  },

  /** Fecha a análise com o levantamento. Devolve false se a análise já não estava em curso (foi eliminada ou dada como interrompida). */
  async complete(db: Queryable, companyId: string, id: string, result: AnalysisResult, findings: readonly NewFinding[]): Promise<boolean> {
    const updated = await db.query(
      `UPDATE document_analyses
       SET status = 'done', issuer = $3, document_type = $4, document_language = $5, document_date = $6,
           summary = $7, model = $8, completed_at = CURRENT_TIMESTAMP
       WHERE company_id = $1 AND id = $2 AND status = 'processing'`,
      [companyId, id, result.issuer, result.documentType, result.documentLanguage, result.documentDate, result.summary, result.model],
    );
    if (updated.rowCount !== 1) return false;
    for (const [index, finding] of findings.entries()) {
      await db.query(
        `INSERT INTO document_findings (company_id, analysis_id, position, requirement_code, suggested_requirement_code,
           topic, request, obligation, deadline, deadline_text, consequence, quote, quote_verified, quote_page)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          companyId,
          id,
          index + 1,
          finding.requirementCode,
          finding.topic,
          finding.request,
          finding.obligation,
          finding.deadline,
          finding.deadlineText,
          finding.consequence,
          finding.quote,
          finding.quoteVerified,
          finding.quotePage,
        ],
      );
    }
    return true;
  },

  async fail(db: Queryable, companyId: string, id: string, code: string, message: string): Promise<void> {
    await db.query(
      `UPDATE document_analyses
       SET status = 'failed', failure_code = $3, failure_message = $4, completed_at = CURRENT_TIMESTAMP
       WHERE company_id = $1 AND id = $2 AND status = 'processing'`,
      [companyId, id, code, message],
    );
  },

  async remove(db: Queryable, companyId: string, id: string): Promise<boolean> {
    const { rowCount } = await db.query('DELETE FROM document_analyses WHERE company_id = $1 AND id = $2', [companyId, id]);
    return rowCount === 1;
  },

  async findings(db: Queryable, companyId: string, analysisId: string): Promise<DocumentFinding[]> {
    const { rows } = await db.query<FindingRow>(
      `SELECT ${FINDING_COLUMNS}
       FROM document_findings f
       LEFT JOIN users r ON r.id = f.reviewed_by
       WHERE f.company_id = $1 AND f.analysis_id = $2
       ORDER BY f.position`,
      [companyId, analysisId],
    );
    return rows.map(toFinding);
  },

  async findFinding(db: Queryable, companyId: string, analysisId: string, findingId: string): Promise<DocumentFinding | null> {
    const { rows } = await db.query<FindingRow>(
      `SELECT ${FINDING_COLUMNS}
       FROM document_findings f
       LEFT JOIN users r ON r.id = f.reviewed_by
       WHERE f.company_id = $1 AND f.analysis_id = $2 AND f.id = $3`,
      [companyId, analysisId, findingId],
    );
    return rows[0] ? toFinding(rows[0]) : null;
  },

  /** Decisão do consultor sobre uma exigência: confirmar, rejeitar, repor ou reclassificar. */
  async review(db: Queryable, companyId: string, findingId: string, reviewerId: string, review: FindingReview): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [companyId, findingId];
    if (review.reviewStatus !== undefined) {
      values.push(review.reviewStatus, reviewerId);
      sets.push(
        `review_status = $${values.length - 1}::document_finding_review`,
        `reviewed_by = CASE WHEN $${values.length - 1} = 'pending' THEN NULL ELSE $${values.length}::uuid END`,
        `reviewed_at = CASE WHEN $${values.length - 1} = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END`,
      );
    }
    if (review.requirementCode !== undefined) {
      values.push(review.requirementCode);
      sets.push(`requirement_code = $${values.length}`);
    }
    if (sets.length === 0) return;
    await db.query(`UPDATE document_findings SET ${sets.join(', ')} WHERE company_id = $1 AND id = $2`, values);
  },

  /** Exigências confirmadas que correspondem a um requisito do stress test: a evidência do plano. */
  async evidence(db: Queryable, companyId: string): Promise<RequirementEvidence[]> {
    const { rows } = await db.query<{
      finding_id: string;
      analysis_id: string;
      requirement_code: RequirementCode;
      topic: string;
      request: string;
      obligation: FindingObligation;
      deadline: string | null;
      deadline_text: string | null;
      consequence: string | null;
      quote: string;
      quote_page: number | null;
      file_name: string;
      issuer: string | null;
      document_date: string | null;
    }>(
      `SELECT f.id AS finding_id, f.analysis_id, f.requirement_code, f.topic, f.request, f.obligation, f.deadline,
              f.deadline_text, f.consequence, f.quote, f.quote_page, a.file_name, a.issuer, a.document_date
       FROM document_findings f
       JOIN document_analyses a ON a.id = f.analysis_id AND a.company_id = f.company_id
       WHERE f.company_id = $1 AND f.review_status = 'confirmed' AND f.quote_verified
         AND f.requirement_code IS NOT NULL AND a.status = 'done'
       ORDER BY f.requirement_code, f.deadline NULLS LAST, a.created_at, f.position`,
      [companyId],
    );
    return rows.map((row) => ({
      findingId: row.finding_id,
      analysisId: row.analysis_id,
      requirementCode: row.requirement_code,
      topic: row.topic,
      request: row.request,
      obligation: row.obligation,
      deadline: row.deadline,
      deadlineText: row.deadline_text,
      consequence: row.consequence,
      quote: row.quote,
      quotePage: row.quote_page,
      fileName: row.file_name,
      issuer: row.issuer,
      documentDate: row.document_date,
    }));
  },
};
