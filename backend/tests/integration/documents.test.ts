// Análise de documentos com IA. A API da Anthropic é substituída por um analisador simulado:
// o que se testa aqui é tudo o que rodeia a chamada (quem pode, o que se guarda, a verificação
// das citações, a revisão do consultor e o que chega ao plano do cliente).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/config/database.js';
import type {
  AuthSession,
  DocumentAnalysisDetail,
  DocumentAnalysisSummary,
  DocumentListResponse,
  RequirementEvidence,
} from '../../src/models/api.types.js';
import { AnalysisFailure, type AnalyzerInput, type DocumentAnalyzer, type Extraction } from '../../src/services/document-analyzer.js';
import { documentService, setDocumentAnalyzer } from '../../src/services/document.service.js';
import { app, bearer, login, resetDatabase, seedFixture, type Fixture } from './helpers.js';

let fx: Fixture;
let consultant: AuthSession;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  fx = await seedFixture();
  consultant = await login('consultora@p4s.test', fx.companyA.id);
});

afterEach(async () => {
  await documentService.whenIdle();
  setDocumentAnalyzer(undefined);
});

afterAll(async () => {
  await pool.end();
});

const QUESTIONNAIRE = readFileSync(path.resolve('..', 'exemplos', 'questionario-fornecedor-exemplo.pdf'));
const BANK_LETTER = readFileSync(path.resolve('..', 'exemplos', 'carta-banco-exemplo.docx'));
const SCANNED = readFileSync(path.resolve('tests', 'fixtures', 'digitalizado.pdf'));

const QUOTE_ECOVADIS = 'Suppliers must hold a valid EcoVadis assessment with a minimum overall score of 55 points no later than 30 June 2027.';
const QUOTE_SCOPE_12 =
  'Suppliers shall report their Scope 1 and Scope 2 greenhouse gas emissions for the previous calendar year, calculated in accordance with the GHG Protocol Corporate Standard, by 31 March of each year';
const QUOTE_CONDUCT = 'Suppliers must sign the Nordwerk Supplier Code of Conduct';
const QUOTE_INVENTED = 'Suppliers must be certified to ISO 50001 before 1 January 2027.';
/** Frase do documento que nenhuma exigência cita: não pode aparecer na base de dados. */
const UNQUOTED_SENTENCE = 'This commitment cannot be met without the active contribution';

const QUESTIONNAIRE_EXTRACTION: Extraction = {
  issuer: 'Nordwerk Automotive Systems GmbH',
  documentType: 'Requisitos de sustentabilidade para fornecedores',
  language: 'inglês',
  documentDate: '2026-09-15',
  summary: 'A Nordwerk exige EcoVadis, pegada de carbono e TISAX aos fornecedores de moldes.',
  findings: [
    {
      requirementCode: 'ecovadis',
      topic: 'Avaliação EcoVadis com 55 pontos',
      request: 'Ter uma avaliação EcoVadis válida com pelo menos 55 pontos.',
      obligation: 'mandatory',
      deadline: '2027-06-30',
      deadlineText: 'no later than 30 June 2027',
      consequence: 'Exclusão de novas adjudicações.',
      quote: QUOTE_ECOVADIS,
      page: 1,
    },
    {
      requirementCode: 'carbon_scope_1_2',
      topic: 'Reporte anual dos âmbitos 1 e 2',
      request: 'Reportar as emissões dos âmbitos 1 e 2 segundo o GHG Protocol.',
      obligation: 'mandatory',
      deadline: null,
      deadlineText: 'by 31 March of each year, starting on 31 March 2027',
      consequence: null,
      quote: QUOTE_SCOPE_12,
      // Página errada de propósito: o servidor encontra a certa.
      page: 1,
    },
    {
      requirementCode: 'other',
      topic: 'Código de conduta',
      request: 'Assinar o código de conduta de fornecedores.',
      obligation: 'mandatory',
      deadline: null,
      deadlineText: null,
      consequence: null,
      quote: QUOTE_CONDUCT,
      page: 3,
    },
    {
      requirementCode: 'information_security',
      topic: 'Certificação de energia',
      request: 'Ter certificação ISO 50001.',
      obligation: 'mandatory',
      deadline: '2027-01-01',
      deadlineText: null,
      consequence: null,
      quote: QUOTE_INVENTED,
      page: 2,
    },
  ],
};

const EMPTY_EXTRACTION: Extraction = {
  issuer: null,
  documentType: null,
  language: null,
  documentDate: null,
  summary: 'Sem exigências ao fornecedor.',
  findings: [],
};

function stubAnalyzer(respond: (input: AnalyzerInput) => Extraction | Promise<Extraction>): DocumentAnalyzer & { calls: AnalyzerInput[] } {
  const calls: AnalyzerInput[] = [];
  return {
    model: 'modelo-de-teste',
    calls,
    async analyze(input) {
      calls.push(input);
      return { extraction: await respond(input), model: 'modelo-que-respondeu' };
    },
  };
}

const upload = (session: AuthSession, file: Buffer, fileName = 'questionario.pdf') =>
  request(app)
    .post('/api/v1/documents')
    .set(bearer(session))
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', encodeURIComponent(fileName))
    .send(file);

const textFile = (label: string) => Buffer.from(`Documento ${label}. ${'O fornecedor deve reportar a pegada de carbono todos os anos. '.repeat(6)}`);

async function analysed(session: AuthSession, file: Buffer = QUESTIONNAIRE, fileName = 'questionario.pdf'): Promise<DocumentAnalysisDetail> {
  const response = await upload(session, file, fileName);
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  await documentService.whenIdle();
  const detail = await request(app).get(`/api/v1/documents/${(response.body as DocumentAnalysisSummary).id}`).set(bearer(session));
  expect(detail.status).toBe(200);
  return detail.body as DocumentAnalysisDetail;
}

const review = (session: AuthSession, analysisId: string, findingId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/v1/documents/${analysisId}/findings/${findingId}`).set(bearer(session)).send(body);

const evidenceFor = async (session: AuthSession): Promise<RequirementEvidence[]> => {
  const response = await request(app).get('/api/v1/documents/evidence').set(bearer(session));
  expect(response.status).toBe(200);
  return response.body as RequirementEvidence[];
};

describe('sem chave da API', () => {
  it('a funcionalidade aparece como não configurada e nenhum documento é aceite', async () => {
    setDocumentAnalyzer(null);
    const list = await request(app).get('/api/v1/documents').set(bearer(consultant));
    expect(list.status).toBe(200);
    expect((list.body as DocumentListResponse).ai).toEqual({ configured: false, model: null });

    const response = await upload(consultant, QUESTIONNAIRE);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AI_NOT_CONFIGURED');
    const { rows } = await pool.query('SELECT 1 FROM document_analyses');
    expect(rows).toHaveLength(0);
  });

  it('por omissão (sem ANTHROPIC_API_KEY no ambiente) está desligada', async () => {
    const list = await request(app).get('/api/v1/documents').set(bearer(consultant));
    expect((list.body as DocumentListResponse).ai.configured).toBe(false);
  });
});

describe('quem pode', () => {
  it('só a equipa P4S carrega, lista, revê e elimina', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    const detail = await analysed(consultant);
    const finding = detail.findings[0]!;
    const company = await login('gestor@empresa-a.test');

    expect((await request(app).get('/api/v1/documents').set(bearer(company))).status).toBe(403);
    expect((await upload(company, textFile('da empresa'))).status).toBe(403);
    expect((await request(app).get(`/api/v1/documents/${detail.id}`).set(bearer(company))).status).toBe(403);
    expect((await review(company, detail.id, finding.id, { reviewStatus: 'confirmed' })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/documents/${detail.id}`).set(bearer(company))).status).toBe(403);

    const after = await request(app).get(`/api/v1/documents/${detail.id}`).set(bearer(consultant));
    expect((after.body as DocumentAnalysisDetail).findings[0]?.reviewStatus).toBe('pending');
  });

  it('sem sessão nada responde, e o ficheiro nem chega a ser lido', async () => {
    const analyzer = stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION);
    setDocumentAnalyzer(analyzer);
    const anonymous = await request(app)
      .post('/api/v1/documents')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'q.pdf')
      .send(QUESTIONNAIRE);
    expect(anonymous.status).toBe(401);
    expect((await request(app).get('/api/v1/documents')).status).toBe(401);
    expect((await request(app).get('/api/v1/documents/evidence')).status).toBe(401);
    expect(analyzer.calls).toHaveLength(0);
  });

  it('a equipa P4S tem de ter uma empresa selecionada', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    const noCompany = await login('consultora@p4s.test');
    const response = await upload(noCompany, QUESTIONNAIRE);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('COMPANY_SCOPE_REQUIRED');
  });
});

describe('carregar e analisar', () => {
  it('responde logo com a análise em curso e fecha-a em segundo plano', async () => {
    let release: (value: Extraction) => void = () => undefined;
    const analyzer = stubAnalyzer(() => new Promise<Extraction>((resolve) => (release = resolve)));
    setDocumentAnalyzer(analyzer);

    const response = await upload(consultant, QUESTIONNAIRE, 'Questionário Nordwerk 2026.pdf');
    expect(response.status).toBe(202);
    const summary = response.body as DocumentAnalysisSummary;
    expect(response.headers.location).toBe(`/api/v1/documents/${summary.id}`);
    expect(summary).toMatchObject({
      fileName: 'Questionário Nordwerk 2026.pdf',
      fileKind: 'pdf',
      fileSize: QUESTIONNAIRE.length,
      pageCount: 3,
      status: 'processing',
      uploadedByName: 'Consultora P4S',
      findingCounts: { total: 0, pending: 0, confirmed: 0, rejected: 0, unverified: 0 },
    });

    const during = await request(app).get('/api/v1/documents').set(bearer(consultant));
    expect((during.body as DocumentListResponse).ai).toEqual({ configured: true, model: 'modelo-de-teste' });
    expect((during.body as DocumentListResponse).analyses.map((analysis) => analysis.status)).toEqual(['processing']);

    release(QUESTIONNAIRE_EXTRACTION);
    await documentService.whenIdle();

    const done = await request(app).get(`/api/v1/documents/${summary.id}`).set(bearer(consultant));
    expect(done.body).toMatchObject({
      status: 'done',
      issuer: 'Nordwerk Automotive Systems GmbH',
      documentLanguage: 'inglês',
      documentDate: '2026-09-15',
      model: 'modelo-que-respondeu',
      failureCode: null,
      findingCounts: { total: 4, pending: 4, confirmed: 0, rejected: 0, unverified: 1 },
    });
    expect((done.body as DocumentAnalysisDetail).completedAt).not.toBeNull();

    // O que foi para a IA: o nome limpo e o texto por página.
    expect(analyzer.calls).toHaveLength(1);
    expect(analyzer.calls[0]).toMatchObject({ fileName: 'Questionário Nordwerk 2026.pdf', kind: 'pdf' });
    expect(analyzer.calls[0]?.pages).toHaveLength(3);
  });

  it('o servidor verifica cada citação e diz em que página a encontrou', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    const { findings } = await analysed(consultant);

    expect(findings.map((finding) => finding.position)).toEqual([1, 2, 3, 4]);
    expect(findings[0]).toMatchObject({
      requirementCode: 'ecovadis',
      suggestedRequirementCode: 'ecovadis',
      obligation: 'mandatory',
      deadline: '2027-06-30',
      quote: QUOTE_ECOVADIS,
      quoteVerified: true,
      quotePage: 1,
      reviewStatus: 'pending',
      reviewedByName: null,
    });
    // A IA disse página 1. A citação está na página 2.
    expect(findings[1]).toMatchObject({ requirementCode: 'carbon_scope_1_2', quoteVerified: true, quotePage: 2, deadline: null });
    expect(findings[2]).toMatchObject({ requirementCode: null, suggestedRequirementCode: null, quoteVerified: true, quotePage: 3 });
    // A citação inventada fica registada, mas assinalada.
    expect(findings[3]).toMatchObject({ quote: QUOTE_INVENTED, quoteVerified: false, quotePage: null });
  });

  it('o ficheiro não é guardado: na base de dados só ficam as citações', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    await analysed(consultant);
    const { rows } = await pool.query<{ everything: string }>(
      `SELECT (SELECT string_agg(a::text, ' ') FROM document_analyses a) || ' ' ||
              (SELECT string_agg(f::text, ' ') FROM document_findings f) AS everything`,
    );
    const everything = rows[0]?.everything ?? '';
    expect(everything).toContain('minimum overall score of 55 points');
    expect(everything).not.toContain(UNQUOTED_SENTENCE);
    const columns = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'document_analyses'`,
    );
    expect(columns.rows.some((column) => column.data_type === 'bytea')).toBe(false);
    expect(columns.rows.map((column) => column.column_name)).not.toContain('content');
  });

  it('lê Word (.docx) e texto simples, sem páginas', async () => {
    setDocumentAnalyzer(
      stubAnalyzer((input) => ({
        ...EMPTY_EXTRACTION,
        issuer: 'Banco Exemplo, S.A.',
        findings: [
          {
            requirementCode: 'banking_esg',
            topic: 'Questionário ESG do banco',
            request: 'Enviar o questionário ESG preenchido.',
            obligation: 'mandatory',
            deadline: '2027-01-15',
            deadlineText: 'até 15 de janeiro de 2027',
            consequence: 'Classificação no escalão de risco ESG mais elevado.',
            quote: input.kind === 'docx' ? 'solicitamos que nos enviem, até 15 de janeiro de 2027, o questionário ESG do banco preenchido' : 'O fornecedor deve reportar a pegada de carbono todos os anos.',
            page: 4,
          },
        ],
      })),
    );
    const letter = await analysed(consultant, BANK_LETTER, 'carta-banco.docx');
    expect(letter).toMatchObject({ fileKind: 'docx', pageCount: null, status: 'done' });
    expect(letter.findings[0]).toMatchObject({ requirementCode: 'banking_esg', quoteVerified: true, quotePage: null });

    const notes = await analysed(consultant, textFile('de notas'), 'notas.txt');
    expect(notes).toMatchObject({ fileKind: 'txt', pageCount: null, status: 'done' });
    expect(notes.findings[0]).toMatchObject({ quoteVerified: true, quotePage: null });
  });

  it('um documento sem exigências fecha com a lista vazia', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => EMPTY_EXTRACTION));
    const detail = await analysed(consultant);
    expect(detail).toMatchObject({ status: 'done', summary: 'Sem exigências ao fornecedor.', issuer: null });
    expect(detail.findings).toEqual([]);
  });

  it('o nome do ficheiro fica sem caminho, e é obrigatório', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => EMPTY_EXTRACTION));
    const named = await upload(consultant, textFile('com caminho'), '..\\..\\Clientes/Açúcar & Cª/pedido (v2).txt');
    expect(named.status).toBe(202);
    expect((named.body as DocumentAnalysisSummary).fileName).toBe('pedido (v2).txt');

    const missing = await request(app)
      .post('/api/v1/documents')
      .set(bearer(consultant))
      .set('Content-Type', 'application/octet-stream')
      .send(textFile('sem nome'));
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/X-File-Name/);

    const badlyEncoded = await request(app)
      .post('/api/v1/documents')
      .set(bearer(consultant))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', '%E0%A4%A')
      .send(textFile('mal codificado'));
    expect(badlyEncoded.status).toBe(400);
  });
});

describe('o que é recusado antes de chegar à IA', () => {
  it('ficheiros que não se conseguem ler não gastam uma chamada nem ficam registados', async () => {
    const analyzer = stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION);
    setDocumentAnalyzer(analyzer);

    const scanned = await upload(consultant, SCANNED, 'digitalizado.pdf');
    expect(scanned.status).toBe(422);
    expect(scanned.body.error.code).toBe('DOCUMENT_WITHOUT_TEXT');

    const binary = await upload(consultant, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4, 5]), 'foto.png');
    expect(binary.status).toBe(422);
    expect(binary.body.error.code).toBe('UNSUPPORTED_DOCUMENT');

    const empty = await upload(consultant, Buffer.alloc(0), 'vazio.pdf');
    expect(empty.status).toBe(400);

    const json = await request(app)
      .post('/api/v1/documents')
      .set(bearer(consultant))
      .set('X-File-Name', 'q.json')
      .send({ ficheiro: 'texto' });
    expect(json.status).toBe(400);
    expect(json.body.error.message).toMatch(/application\/octet-stream/);

    expect(analyzer.calls).toHaveLength(0);
    expect((await pool.query('SELECT 1 FROM document_analyses')).rows).toHaveLength(0);
  });

  it('recusa ficheiros acima de 10 MB', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => EMPTY_EXTRACTION));
    const response = await upload(consultant, Buffer.alloc(10 * 1024 * 1024 + 1, 0x61), 'enorme.txt');
    expect(response.status).toBe(413);
  });

  it('o mesmo ficheiro não se analisa duas vezes para a mesma empresa, mas pode ser analisado para outra', async () => {
    const analyzer = stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION);
    setDocumentAnalyzer(analyzer);
    const first = await analysed(consultant, QUESTIONNAIRE, 'original.pdf');

    const again = await upload(consultant, QUESTIONNAIRE, 'copia.pdf');
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/original\.pdf/);

    const otherCompany = await login('consultora@p4s.test', fx.companyB.id);
    expect((await upload(otherCompany, QUESTIONNAIRE, 'original.pdf')).status).toBe(202);
    await documentService.whenIdle();

    expect((await request(app).delete(`/api/v1/documents/${first.id}`).set(bearer(consultant))).status).toBe(204);
    expect((await upload(consultant, QUESTIONNAIRE, 'copia.pdf')).status).toBe(202);
    await documentService.whenIdle();
    expect(analyzer.calls).toHaveLength(3);
  });

  it('não corre mais de três análises ao mesmo tempo', async () => {
    const releases: Array<(value: Extraction) => void> = [];
    setDocumentAnalyzer(stubAnalyzer(() => new Promise<Extraction>((resolve) => releases.push(resolve))));

    for (const label of ['um', 'dois', 'três']) expect((await upload(consultant, textFile(label), `${label}.txt`)).status).toBe(202);
    const fourth = await upload(consultant, textFile('quatro'), 'quatro.txt');
    expect(fourth.status).toBe(429);

    for (const release of releases) release(EMPTY_EXTRACTION);
    await documentService.whenIdle();
    expect((await upload(consultant, textFile('quatro'), 'quatro.txt')).status).toBe(202);
    releases.at(-1)?.(EMPTY_EXTRACTION);
  });
});

describe('quando a análise falha', () => {
  const failed = async (analyzer: DocumentAnalyzer): Promise<DocumentAnalysisDetail> => {
    setDocumentAnalyzer(analyzer);
    return analysed(consultant);
  };

  it('fica registado porquê, numa mensagem que o consultor consegue resolver', async () => {
    const detail = await failed({
      model: 'm',
      analyze: () => Promise.reject(new AnalysisFailure('AI_RATE_LIMIT', 'O limite de pedidos da conta de IA foi atingido.')),
    });
    expect(detail).toMatchObject({
      status: 'failed',
      failureCode: 'AI_RATE_LIMIT',
      failureMessage: 'O limite de pedidos da conta de IA foi atingido.',
      findings: [],
    });
    expect(detail.completedAt).not.toBeNull();
  });

  it('um erro inesperado não deixa a análise «em curso» para sempre nem mostra detalhes internos', async () => {
    const detail = await failed({ model: 'm', analyze: () => Promise.reject(new Error('segredo interno: ECONNRESET 10.0.0.7')) });
    expect(detail).toMatchObject({ status: 'failed', failureCode: 'INTERNAL' });
    expect(detail.failureMessage).not.toMatch(/segredo|ECONNRESET/);
  });

  it('uma resposta fora do formato é recusada inteira', async () => {
    const malformed = { ...QUESTIONNAIRE_EXTRACTION, findings: [{ topic: 'sem citação' }] } as unknown as Extraction;
    const detail = await failed(stubAnalyzer(() => malformed));
    expect(detail).toMatchObject({ status: 'failed', failureCode: 'AI_INVALID_OUTPUT', findings: [] });
  });

  it('uma análise falhada não impede carregar o mesmo ficheiro outra vez', async () => {
    await failed({ model: 'm', analyze: () => Promise.reject(new AnalysisFailure('AI_UNAVAILABLE', 'Indisponível.')) });
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    const retry = await analysed(consultant);
    expect(retry.status).toBe('done');
    const list = await request(app).get('/api/v1/documents').set(bearer(consultant));
    expect((list.body as DocumentListResponse).analyses.map((analysis) => analysis.status).sort()).toEqual(['done', 'failed']);
  });

  it('uma análise interrompida (o servidor parou a meio) é dada como falhada, e uma resposta tardia já não a altera', async () => {
    let release: (value: Extraction) => void = () => undefined;
    setDocumentAnalyzer(stubAnalyzer(() => new Promise<Extraction>((resolve) => (release = resolve))));
    const response = await upload(consultant, QUESTIONNAIRE);
    const { id } = response.body as DocumentAnalysisSummary;

    // Ainda dentro do prazo: continua em curso.
    let detail = await request(app).get(`/api/v1/documents/${id}`).set(bearer(consultant));
    expect(detail.body.status).toBe('processing');

    await pool.query(`UPDATE document_analyses SET created_at = created_at - INTERVAL '31 minutes' WHERE id = $1`, [id]);
    detail = await request(app).get(`/api/v1/documents/${id}`).set(bearer(consultant));
    expect(detail.body).toMatchObject({ status: 'failed', failureCode: 'INTERRUPTED' });

    release(QUESTIONNAIRE_EXTRACTION);
    await documentService.whenIdle();
    detail = await request(app).get(`/api/v1/documents/${id}`).set(bearer(consultant));
    expect(detail.body).toMatchObject({ status: 'failed', failureCode: 'INTERRUPTED', findings: [] });
  });
});

describe('revisão do consultor', () => {
  let detail: DocumentAnalysisDetail;

  beforeEach(async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    detail = await analysed(consultant);
  });

  it('confirma uma exigência com citação verificada e fica registado quem confirmou', async () => {
    const response = await review(consultant, detail.id, detail.findings[0]!.id, { reviewStatus: 'confirmed' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ reviewStatus: 'confirmed', reviewedByName: 'Consultora P4S' });
    expect(response.body.reviewedAt).not.toBeNull();

    const after = await request(app).get(`/api/v1/documents/${detail.id}`).set(bearer(consultant));
    expect(after.body.findingCounts).toMatchObject({ total: 4, pending: 3, confirmed: 1, rejected: 0 });
  });

  it('não deixa confirmar uma citação que o servidor não encontrou no documento', async () => {
    const invented = detail.findings[3]!;
    const response = await review(consultant, detail.id, invented.id, { reviewStatus: 'confirmed' });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/não foi encontrada no documento/);

    // Nem a base de dados aceita, mesmo que alguém contorne a API.
    await expect(pool.query(`UPDATE document_findings SET review_status = 'confirmed' WHERE id = $1`, [invented.id])).rejects.toThrow(
      /check constraint/,
    );
    // Rejeitar pode sempre.
    expect((await review(consultant, detail.id, invented.id, { reviewStatus: 'rejected' })).body.reviewStatus).toBe('rejected');
  });

  it('rejeita, e repõe como pendente sem deixar o nome de quem tinha decidido', async () => {
    const finding = detail.findings[1]!;
    expect((await review(consultant, detail.id, finding.id, { reviewStatus: 'rejected' })).body).toMatchObject({
      reviewStatus: 'rejected',
      reviewedByName: 'Consultora P4S',
    });
    expect((await review(consultant, detail.id, finding.id, { reviewStatus: 'pending' })).body).toMatchObject({
      reviewStatus: 'pending',
      reviewedByName: null,
      reviewedAt: null,
    });
  });

  it('reclassifica sem perder o que a IA tinha proposto, e sem mexer no estado da revisão', async () => {
    const conduct = detail.findings[2]!;
    const moved = await review(consultant, detail.id, conduct.id, { requirementCode: 'ecovadis' });
    expect(moved.body).toMatchObject({ requirementCode: 'ecovadis', suggestedRequirementCode: null, reviewStatus: 'pending' });

    const scope = detail.findings[1]!;
    const both = await review(consultant, detail.id, scope.id, { requirementCode: null, reviewStatus: 'confirmed' });
    expect(both.body).toMatchObject({ requirementCode: null, suggestedRequirementCode: 'carbon_scope_1_2', reviewStatus: 'confirmed' });
  });

  it('valida o pedido', async () => {
    const finding = detail.findings[0]!;
    expect((await review(consultant, detail.id, finding.id, {})).status).toBe(400);
    expect((await review(consultant, detail.id, finding.id, { reviewStatus: 'aprovado' })).status).toBe(400);
    expect((await review(consultant, detail.id, finding.id, { requirementCode: 'iso_14001' })).status).toBe(400);
    expect((await review(consultant, detail.id, finding.id, { reviewStatus: 'confirmed', quoteVerified: true })).status).toBe(400);
    expect((await review(consultant, detail.id, 'nao-e-um-id', { reviewStatus: 'confirmed' })).status).toBe(400);
    expect((await review(consultant, detail.id, detail.id, { reviewStatus: 'confirmed' })).status).toBe(404);
  });
});

describe('evidência no plano do cliente', () => {
  it('só as exigências confirmadas, com requisito e citação verificada, chegam à empresa', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    const detail = await analysed(consultant);
    const company = await login('gestor@empresa-a.test');
    expect(await evidenceFor(company)).toEqual([]);

    await review(consultant, detail.id, detail.findings[0]!.id, { reviewStatus: 'confirmed' });
    // Confirmada mas fora dos cinco requisitos: não entra na matriz.
    await review(consultant, detail.id, detail.findings[2]!.id, { reviewStatus: 'confirmed' });
    await review(consultant, detail.id, detail.findings[1]!.id, { reviewStatus: 'rejected' });

    const evidence = await evidenceFor(company);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toEqual({
      findingId: detail.findings[0]!.id,
      analysisId: detail.id,
      requirementCode: 'ecovadis',
      topic: 'Avaliação EcoVadis com 55 pontos',
      request: 'Ter uma avaliação EcoVadis válida com pelo menos 55 pontos.',
      obligation: 'mandatory',
      deadline: '2027-06-30',
      deadlineText: 'no later than 30 June 2027',
      consequence: 'Exclusão de novas adjudicações.',
      quote: QUOTE_ECOVADIS,
      quotePage: 1,
      fileName: 'questionario.pdf',
      issuer: 'Nordwerk Automotive Systems GmbH',
      documentDate: '2026-09-15',
    });
    expect(await evidenceFor(consultant)).toEqual(evidence);

    // Voltar atrás tira-a do plano. Eliminar o documento também.
    await review(consultant, detail.id, detail.findings[0]!.id, { reviewStatus: 'pending' });
    expect(await evidenceFor(company)).toEqual([]);
    await review(consultant, detail.id, detail.findings[0]!.id, { reviewStatus: 'confirmed' });
    expect(await evidenceFor(company)).toHaveLength(1);
    expect((await request(app).delete(`/api/v1/documents/${detail.id}`).set(bearer(consultant))).status).toBe(204);
    expect(await evidenceFor(company)).toEqual([]);
    expect((await pool.query('SELECT 1 FROM document_findings')).rows).toHaveLength(0);
  });
});

describe('isolamento entre empresas', () => {
  it('os documentos e a evidência de uma empresa não existem para as outras', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    const detail = await analysed(consultant);
    const finding = detail.findings[0]!;
    await review(consultant, detail.id, finding.id, { reviewStatus: 'confirmed' });

    const inCompanyB = await login('consultora@p4s.test', fx.companyB.id);
    expect(((await request(app).get('/api/v1/documents').set(bearer(inCompanyB))).body as DocumentListResponse).analyses).toEqual([]);
    expect((await request(app).get(`/api/v1/documents/${detail.id}`).set(bearer(inCompanyB))).status).toBe(404);
    expect((await review(inCompanyB, detail.id, finding.id, { reviewStatus: 'rejected' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/documents/${detail.id}`).set(bearer(inCompanyB))).status).toBe(404);
    expect(await evidenceFor(inCompanyB)).toEqual([]);
    expect(await evidenceFor(await login('gestor@empresa-b.test'))).toEqual([]);

    // Continua tudo no sítio para a empresa A.
    expect(await evidenceFor(await login('gestor@empresa-a.test'))).toHaveLength(1);
  });

  it('eliminar a empresa leva os documentos analisados', async () => {
    setDocumentAnalyzer(stubAnalyzer(() => QUESTIONNAIRE_EXTRACTION));
    await analysed(consultant);
    await pool.query('DELETE FROM companies WHERE id = $1', [fx.companyA.id]);
    expect((await pool.query('SELECT 1 FROM document_analyses')).rows).toHaveLength(0);
    expect((await pool.query('SELECT 1 FROM document_findings')).rows).toHaveLength(0);
  });
});
