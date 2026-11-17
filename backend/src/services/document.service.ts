// Análise de documentos com IA, como ferramenta interna do consultor.
//
// O que garante que isto é fiável:
//  1. O ficheiro nunca é guardado: lê-se o texto em memória e fica só o levantamento.
//  2. Cada exigência traz uma citação literal, e o servidor confirma que ela existe no texto
//     do documento. Uma citação que não se encontra nunca pode ser confirmada.
//  3. Nada chega ao plano do cliente sem um consultor confirmar, exigência a exigência.

import { createHash } from 'node:crypto';
import { pool, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import type {
  DocumentAnalysisDetail,
  DocumentAnalysisSummary,
  DocumentFinding,
  DocumentListResponse,
  RequirementEvidence,
} from '../models/api.types.js';
import { documentModel, type FindingReview, type NewFinding } from '../models/document.model.js';
import type { TenantContext } from '../models/domain.js';
import { isValidIsoDate } from '../utils/dates.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import {
  AnalysisFailure,
  createAnthropicAnalyzer,
  extractionSchema,
  type DocumentAnalyzer,
  type Extraction,
} from './document-analyzer.js';
import { ACCEPTED_EXTENSIONS, MAX_DOCUMENT_BYTES, extractDocumentText, type ExtractedDocument } from './document-text.js';
import { createQuoteVerifier, quoteFingerprint } from './quote-verifier.js';

/** Análises em simultâneo neste servidor. Acima disto, o pedido seguinte espera. */
const MAX_CONCURRENT_ANALYSES = 3;

let analyzerOverride: DocumentAnalyzer | null | undefined;
let analyzerFromEnv: DocumentAnalyzer | null | undefined;

/** Analisador em uso. Null: a chave da API não está configurada e nada sai do servidor. */
function resolveAnalyzer(): DocumentAnalyzer | null {
  if (analyzerOverride !== undefined) return analyzerOverride;
  if (analyzerFromEnv === undefined) {
    analyzerFromEnv = env.ANTHROPIC_API_KEY
      ? createAnthropicAnalyzer({ apiKey: env.ANTHROPIC_API_KEY, model: env.P4S_AI_MODEL })
      : null;
  }
  return analyzerFromEnv;
}

/** Só para testes: troca o analisador (undefined repõe o da configuração). */
export function setDocumentAnalyzer(analyzer: DocumentAnalyzer | null | undefined): void {
  analyzerOverride = analyzer;
}

const jobs = new Set<Promise<void>>();

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const optionalLine = (value: string | null, max: number): string | null => {
  const text = value === null ? '' : oneLine(value);
  return text ? clip(text, max) : null;
};
const isoDateOrNull = (value: string | null): string | null => (value && isValidIsoDate(value.trim()) ? value.trim() : null);

/**
 * Passa a resposta da IA para o que se guarda. É aqui que cada citação é procurada no texto do
 * documento. Linhas sem citação ou sem pedido não entram: não há nada que as sustente.
 */
export function toFindings(extraction: Extraction, document: Pick<ExtractedDocument, 'kind' | 'pages'>): NewFinding[] {
  const verify = createQuoteVerifier(document.pages);
  const seen = new Set<string>();
  const findings: NewFinding[] = [];

  for (const item of extraction.findings) {
    const quote = item.quote.trim();
    const request = oneLine(item.request);
    if (!quote || !request) continue;

    const requirementCode = item.requirementCode === 'other' ? null : item.requirementCode;
    const key = `${requirementCode ?? 'other'}|${quoteFingerprint(quote)}|${quoteFingerprint(request)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const match = verify(quote, item.page);
    const deadline = isoDateOrNull(item.deadline);
    // Um prazo que não é uma data válida não se perde: fica como texto.
    const deadlineText = optionalLine(item.deadlineText, 300) ?? (deadline ? null : optionalLine(item.deadline, 300));

    findings.push({
      requirementCode,
      topic: clip(oneLine(item.topic) || request, 200),
      request: clip(request, 2000),
      obligation: item.obligation,
      deadline,
      deadlineText,
      consequence: optionalLine(item.consequence, 1000),
      quote,
      quoteVerified: match.verified,
      // Só os PDF têm páginas.
      quotePage: document.kind === 'pdf' ? match.page : null,
    });
  }
  return findings;
}

async function runAnalysis(
  analyzer: DocumentAnalyzer,
  companyId: string,
  analysisId: string,
  fileName: string,
  document: ExtractedDocument,
): Promise<void> {
  try {
    const output = await analyzer.analyze({ fileName, kind: document.kind, pages: document.pages });
    const parsed = extractionSchema.safeParse(output.extraction);
    if (!parsed.success) {
      throw new AnalysisFailure('AI_INVALID_OUTPUT', 'O modelo não devolveu um levantamento que se consiga ler. Tente de novo.');
    }
    const extraction = parsed.data;
    const findings = toFindings(extraction, document);
    await withTransaction((client) =>
      documentModel.complete(
        client,
        companyId,
        analysisId,
        {
          issuer: optionalLine(extraction.issuer, 255),
          documentType: optionalLine(extraction.documentType, 160),
          documentLanguage: optionalLine(extraction.language, 60),
          documentDate: isoDateOrNull(extraction.documentDate),
          summary: clip(oneLine(extraction.summary), 2000),
          model: clip(output.model, 80),
        },
        findings,
      ),
    );
  } catch (error) {
    const failure =
      error instanceof AnalysisFailure
        ? error
        : new AnalysisFailure('INTERNAL', 'A análise falhou por um erro interno. Tente de novo.');
    // O registo leva o tipo de erro e nunca o conteúdo do documento.
    if (!(error instanceof AnalysisFailure)) {
      console.error('[ia] a análise falhou', (error as Error)?.name, (error as Error)?.message);
    }
    await documentModel
      .fail(pool, companyId, analysisId, failure.code, failure.message)
      .catch((dbError: unknown) => console.error('[ia] não foi possível registar a falha da análise', (dbError as Error)?.message));
  }
}

/** Nome do ficheiro como é guardado e mostrado: sem caminho, sem caracteres de controlo, numa linha. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const name = oneLine(base.normalize('NFC').replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, ' '));
  if (!name) throw badRequest('Indique o nome do ficheiro.');
  return name.length > 255 ? name.slice(-255) : name;
}

export const documentService = {
  async list(ctx: TenantContext): Promise<DocumentListResponse> {
    await documentModel.failStale(pool, ctx.companyId);
    const analyzer = resolveAnalyzer();
    return {
      ai: { configured: analyzer !== null, model: analyzer?.model ?? null },
      limits: { maxBytes: MAX_DOCUMENT_BYTES, acceptedExtensions: [...ACCEPTED_EXTENSIONS] },
      analyses: await documentModel.list(pool, ctx.companyId),
    };
  },

  async get(ctx: TenantContext, id: string): Promise<DocumentAnalysisDetail> {
    await documentModel.failStale(pool, ctx.companyId);
    const summary = await documentModel.findById(pool, ctx.companyId, id);
    if (!summary) throw notFound('Documento não encontrado.');
    return { ...summary, findings: await documentModel.findings(pool, ctx.companyId, id) };
  },

  /**
   * Lê o documento, regista a análise e responde logo. A chamada à IA corre depois, em segundo
   * plano: quem carregou acompanha o estado (processing → done ou failed).
   */
  async upload(ctx: TenantContext, rawFileName: string, buffer: Buffer): Promise<DocumentAnalysisSummary> {
    const analyzer = resolveAnalyzer();
    if (!analyzer) {
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        'A análise com IA não está configurada neste servidor (falta ANTHROPIC_API_KEY). Nenhum documento foi enviado.',
      );
    }
    const fileName = cleanFileName(rawFileName);
    if (jobs.size >= MAX_CONCURRENT_ANALYSES) {
      throw new AppError(429, 'TOO_MANY_REQUESTS', 'Já há documentos em análise. Aguarde que terminem e carregue de novo.');
    }

    await documentModel.failStale(pool, ctx.companyId);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = await documentModel.findActiveBySha(pool, ctx.companyId, sha256);
    if (existing) {
      throw conflict(
        `Este ficheiro já foi analisado para esta empresa («${existing.fileName}»). Para o analisar de novo, elimine primeiro essa análise.`,
      );
    }

    const document = await extractDocumentText(buffer, fileName);
    const id = await documentModel.insert(pool, ctx.companyId, {
      uploadedBy: ctx.userId,
      fileName,
      fileKind: document.kind,
      fileSize: buffer.length,
      fileSha256: sha256,
      pageCount: document.pageCount,
      charCount: document.charCount,
    });

    const job = runAnalysis(analyzer, ctx.companyId, id, fileName, document).finally(() => jobs.delete(job));
    jobs.add(job);

    const summary = await documentModel.findById(pool, ctx.companyId, id);
    if (!summary) throw notFound('Documento não encontrado.');
    return summary;
  },

  async remove(ctx: TenantContext, id: string): Promise<void> {
    if (!(await documentModel.remove(pool, ctx.companyId, id))) throw notFound('Documento não encontrado.');
  },

  /** Decisão do consultor. Confirmar exige que o servidor tenha encontrado a citação no documento. */
  async reviewFinding(ctx: TenantContext, analysisId: string, findingId: string, review: FindingReview): Promise<DocumentFinding> {
    const finding = await documentModel.findFinding(pool, ctx.companyId, analysisId, findingId);
    if (!finding) throw notFound('Exigência não encontrada.');
    if (review.reviewStatus === 'confirmed' && !finding.quoteVerified) {
      throw conflict('A citação desta exigência não foi encontrada no documento, por isso não pode ser confirmada. Confirme no original e, se a exigência existir, registe-a no plano à mão.');
    }
    await documentModel.review(pool, ctx.companyId, findingId, ctx.userId, review);
    const updated = await documentModel.findFinding(pool, ctx.companyId, analysisId, findingId);
    if (!updated) throw notFound('Exigência não encontrada.');
    return updated;
  },

  /** Evidência confirmada, por requisito. A empresa também a vê: são documentos dos seus clientes e do seu banco. */
  evidence(ctx: TenantContext): Promise<RequirementEvidence[]> {
    return documentModel.evidence(pool, ctx.companyId);
  },

  /** Espera pelas análises em curso (testes e encerramento). */
  async whenIdle(): Promise<void> {
    while (jobs.size > 0) await Promise.allSettled([...jobs]);
  },
};
