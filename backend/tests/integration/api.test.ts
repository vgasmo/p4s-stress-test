import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/config/database.js';
import type {
  AssessmentDetail,
  AssignableUser,
  AuthSession,
  CreatedAssessment,
  FullSimulation,
  PublicSimulation,
} from '../../src/models/api.types.js';
import type { Task } from '../../src/models/domain.js';
import {
  AUTOMOTIVE_ANSWERS,
  app,
  bearer,
  login,
  nifFrom,
  resetDatabase,
  seedFixture,
  type Fixture,
} from './helpers.js';

let fx: Fixture;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  fx = await seedFixture();
});

afterAll(async () => {
  await pool.end();
});

const count = async (table: 'assessments' | 'tasks' | 'companies') =>
  Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);

async function createAssessmentAs(session: AuthSession, body: Record<string, unknown> = AUTOMOTIVE_ANSWERS) {
  const response = await request(app).post('/api/v1/assessments').set(bearer(session)).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as CreatedAssessment;
}

/** Só a equipa P4S grava diagnósticos: a consultora, com a empresa A selecionada. */
const consultantForA = () => login('consultora@p4s.test', fx.companyA.id);

const taskByDomain = (detail: AssessmentDetail, domain: Task['domain']) => {
  const task = detail.tasks.find((t) => t.domain === domain);
  if (!task) throw new Error(`Sem tarefa ${domain}`);
  return task;
};

describe('auth', () => {
  it('login devolve tokens e utilizador sem hash', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'GESTOR@empresa-a.test', password: 'Palavra-passe-de-teste-123' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tokenType: 'Bearer', companyId: fx.companyA.id });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    const claims = jwt.decode(response.body.accessToken) as Record<string, unknown>;
    expect(claims).toMatchObject({ userId: fx.userA.id, companyId: fx.companyA.id, role: 'company_user' });
  });

  it.each([
    ['palavra-passe errada', 'gestor@empresa-a.test', 'errada'],
    ['email desconhecido', 'ninguem@empresa-a.test', 'Palavra-passe-de-teste-123'],
    ['utilizador inativo', 'antigo@empresa-a.test', 'Palavra-passe-de-teste-123'],
  ])('recusa %s com a mesma mensagem', async (_label, email, password) => {
    const response = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Email ou palavra-passe incorretos.');
  });

  it('utilizador da empresa não pode entrar noutra empresa', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'gestor@empresa-a.test', password: 'Palavra-passe-de-teste-123', companyId: fx.companyB.id });
    expect(response.status).toBe(403);
  });

  it('consultor sem empresa selecionada não acede a avaliações', async () => {
    const session = await login('consultora@p4s.test');
    expect(session.companyId).toBeNull();
    const response = await request(app).get('/api/v1/assessments').set(bearer(session));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('COMPANY_SCOPE_REQUIRED');
  });

  it('refresh muda a empresa do consultor e /me reflete-a', async () => {
    const session = await login('consultora@p4s.test');
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, companyId: fx.companyB.id });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.companyId).toBe(fx.companyB.id);

    const me = await request(app).get('/api/v1/auth/me').set(bearer(refreshed.body));
    expect(me.status).toBe(200);
    expect(me.body.company.nif).toBe(fx.companyB.nif);
  });

  it('refresh de utilizador da empresa não muda de empresa', async () => {
    const session = await login('gestor@empresa-a.test');
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, companyId: fx.companyB.id });
    expect(response.status).toBe(403);
  });

  it('refresh recusa um access token', async () => {
    const session = await login('gestor@empresa-a.test');
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.accessToken });
    expect(response.status).toBe(401);
  });

  it('refresh recusa utilizador desativado entretanto', async () => {
    const session = await login('gestor@empresa-a.test');
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [fx.userA.id]);
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(response.status).toBe(401);
  });

  it.each([
    ['sem token', undefined],
    ['token adulterado', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.assinatura'],
    [
      'alg none',
      `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
        '{"typ":"access","userId":"00000000-0000-0000-0000-000000000000","companyId":null,"role":"admin"}',
      ).toString('base64url')}.`,
    ],
    ['token com outro segredo', `Bearer ${jwt.sign({ typ: 'access' }, 'outro-segredo-qualquer-com-32-caracteres!')}`],
  ])('recusa pedido %s', async (_label, header) => {
    const req = request(app).get('/api/v1/tasks');
    const response = await (header ? req.set('Authorization', header) : req);
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/assessments/simulate', () => {
  const AUTOMOTIVE = { sectorProfile: 'automotive_molds', annualRevenue: 6_500_000, ...AUTOMOTIVE_ANSWERS };

  it('sem sessão devolve só ordens de grandeza, sem pesos nem preços', async () => {
    const response = await request(app).post('/api/v1/assessments/simulate').send(AUTOMOTIVE);

    expect(response.status).toBe(200);
    const body = response.body as PublicSimulation;
    expect(Object.keys(body).sort()).toEqual(
      [
        'access',
        'commercialRisk',
        'criticalGapCount',
        'engineVersion',
        'exposedClientRevenue',
        'gapCount',
        'gaps',
        'sectorBlocker',
        'sectorProfile',
        'spreadPenalty',
      ].sort(),
    );
    expect(body.access).toBe('public');
    // Score 100 → escalão 80–100% dos 4.030.000 € expostos.
    expect(body.commercialRisk).toEqual({ lowShare: 80, highShare: 100, low: 3_224_000, high: 4_030_000 });
    expect(body.spreadPenalty).toEqual({ lowBps: 25, highBps: 50, low: 7_500, high: 15_000 });
    expect(body.gapCount).toBe(4);
    expect(body.sectorBlocker).toMatch(/pedidos de cotação/);
    expect(JSON.stringify(body)).not.toMatch(/weightPoints|floorPoints|estimatedCost|deadline|remediationSummary|riskScore/);
    expect(body.gaps.map((gap) => Object.keys(gap).sort())).toEqual(
      body.gaps.map(() => ['code', 'critical', 'executorType', 'label', 'phase', 'requiredByLabel', 'solutionTitle']),
    );
  });

  it('a conta de uma empresa recebe o mesmo que um visitante: escalões, sem pesos nem preços', async () => {
    const session = await login('gestor@empresa-a.test');
    const response = await request(app).post('/api/v1/assessments/simulate').set(bearer(session)).send(AUTOMOTIVE);
    expect(response.status).toBe(200);
    expect(response.body.access).toBe('public');
    expect(JSON.stringify(response.body)).not.toMatch(/weightPoints|floorPoints|estimatedCost|riskScore/);
  });

  it('a equipa P4S recebe o cálculo completo', async () => {
    const session = await login('consultora@p4s.test');
    const response = await request(app).post('/api/v1/assessments/simulate').set(bearer(session)).send(AUTOMOTIVE);

    expect(response.status).toBe(200);
    const body = response.body as FullSimulation;
    expect(body.access).toBe('full');
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        'riskScore',
        'commercialRevenueAtRisk',
        'estimatedSpreadPenalty',
        'remediationSummary',
        'suggestedTasks',
      ]),
    );
    // Automóvel: EcoVadis 45 + Âmbito 3 30 + TISAX 35 = 110 → limitado a 100.
    expect(body.riskScore).toBe(100);
    expect(body.commercialRevenueAtRisk).toBe(4_030_000);
    expect(body.estimatedSpreadPenalty).toBe(12_000);
    expect(body.dealbreaker).toMatchObject({ floorPoints: 75, triggeredBy: ['information_security'] });
    expect(body.remediationSummary).toEqual({
      phase1Cost: 9_800, // EcoVadis 3.500 + Banca 1.800 + TISAX (Fase 1 no automóvel) 4.500
      phase2Cost: 3_800,
      totalInvestment: 13_600,
      phase1CostShareOfRisk: 0.24,
      totalCostShareOfRisk: 0.34,
    });
    expect(body.suggestedTasks.map((t) => t.domain)).toEqual([
      'ecovadis',
      'carbon_footprint',
      'banking_esg',
      'information_security',
    ]);
    expect(body.requirements).toHaveLength(5);
  });

  it('um token inválido é recusado em vez de responder como anónimo', async () => {
    const response = await request(app)
      .post('/api/v1/assessments/simulate')
      .set('Authorization', 'Bearer token-invalido')
      .send(AUTOMOTIVE);
    expect(response.status).toBe(401);
  });

  it('não grava nada', async () => {
    await request(app)
      .post('/api/v1/assessments/simulate')
      .send({ sectorProfile: 'general_industrial', annualRevenue: 1_000_000, ...AUTOMOTIVE_ANSWERS })
      .expect(200);
    expect(await count('assessments')).toBe(0);
    expect(await count('tasks')).toBe(0);
  });

  it.each([
    ['sem setor', { annualRevenue: 1_000_000, ...AUTOMOTIVE_ANSWERS }],
    ['setor inválido', { sectorProfile: 'textil', annualRevenue: 1_000_000, ...AUTOMOTIVE_ANSWERS }],
    ['concentração > 100', { sectorProfile: 'general_industrial', annualRevenue: 1, ...AUTOMOTIVE_ANSWERS, topClientsShare: 120 }],
    ['campo desconhecido', { sectorProfile: 'general_industrial', annualRevenue: 1, ...AUTOMOTIVE_ANSWERS, hack: true }],
    ['booleano como texto', { sectorProfile: 'general_industrial', annualRevenue: 1, ...AUTOMOTIVE_ANSWERS, ecovadis: 'sim' }],
  ])('recusa payload %s com 400', async (_label, body) => {
    const response = await request(app).post('/api/v1/assessments/simulate').send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('recusa JSON malformado', async () => {
    const response = await request(app)
      .post('/api/v1/assessments/simulate')
      .set('Content-Type', 'application/json')
      .send('{"sectorProfile":');
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/assessments (transação atómica)', () => {
  it('grava avaliação e tarefas da empresa da sessão, com setor e faturação da empresa', async () => {
    const session = await consultantForA();
    const detail = await createAssessmentAs(session);

    expect(detail.companyResolution).toBe('session');
    expect(detail.company.id).toBe(fx.companyA.id);
    expect(detail.sectorProfile).toBe('automotive_molds');
    expect(detail.snapshot.input.annualRevenue).toBe(6_500_000);
    expect(detail.commercialRevenueAtRisk).toBe(4_030_000);
    expect(detail.estimatedSpreadPenalty).toBe(12_000);
    expect(detail.creditLineToRefinance).toBe(3_000_000);
    expect(detail.tasks).toHaveLength(4);
    expect(detail.tasks.every((t) => t.companyId === fx.companyA.id && t.assessmentId === detail.id)).toBe(true);
    expect(detail.remediationSummary.totalInvestment).toBe(13_600);
    // Cada tarefa fica ligada ao requisito que a gerou e a quem gravou o diagnóstico.
    expect(detail.tasks.map((t) => t.requirementCode).sort()).toEqual([
      'banking_esg',
      'carbon_scope_3',
      'ecovadis',
      'information_security',
    ]);
    expect(detail.tasks.every((t) => t.origin === 'assessment' && t.createdBy === fx.consultant.id)).toBe(true);
    expect(detail.tasks.every((t) => !/Exigido por/.test(t.description ?? ''))).toBe(true);

    const stored = await pool.query('SELECT revenue_at_risk, estimated_spread_penalty, sector_profile FROM assessments');
    expect(stored.rows).toEqual([
      { revenue_at_risk: 4_030_000, estimated_spread_penalty: 12_000, sector_profile: 'automotive_molds' },
    ]);
    expect(await count('tasks')).toBe(4);
  });

  it('o resultado gravado coincide com a simulação', async () => {
    const body = { sectorProfile: 'automotive_molds', annualRevenue: 6_500_000, ...AUTOMOTIVE_ANSWERS };
    const session = await consultantForA();
    const simulation = (await request(app).post('/api/v1/assessments/simulate').set(bearer(session)).send(body))
      .body as FullSimulation;
    const detail = await createAssessmentAs(session, body);

    expect(detail.riskScore).toBe(simulation.riskScore);
    expect(detail.commercialRevenueAtRisk).toBe(simulation.commercialRevenueAtRisk);
    expect(detail.remediationSummary).toEqual(simulation.remediationSummary);
    expect(detail.tasks.map((t) => t.title).sort()).toEqual(simulation.suggestedTasks.map((t) => t.title).sort());
  });

  it('a equipa P4S cria a empresa na hora por NIF + nome e reutiliza-a pelo NIF', async () => {
    const session = await login('consultora@p4s.test');
    const nif = nifFrom('51234567');
    const body = {
      ...AUTOMOTIVE_ANSWERS,
      company: { name: 'Plásticos da Reunião, Lda', nif },
      sectorProfile: 'agro_packaging',
      annualRevenue: 4_000_000,
    };

    const first = await createAssessmentAs(session, body);
    expect(first.companyResolution).toBe('created');
    expect(first.company).toMatchObject({ nif, sectorProfile: 'agro_packaging', annualRevenue: 4_000_000, cae: '' });
    // Com um NIF que já existe usa-se a empresa que lá está, tal como está, e a resposta diz que foi isso.
    const second = await createAssessmentAs(session, { ...body, company: { name: 'Outro nome', nif } });
    expect(second.companyResolution).toBe('existing');
    expect(second.company).toMatchObject({ id: first.company.id, name: 'Plásticos da Reunião, Lda' });
    expect(await count('companies')).toBe(3);
  });

  it('pedidos em simultâneo para o mesmo NIF novo criam uma só empresa', async () => {
    const session = await login('consultora@p4s.test');
    const body = { ...AUTOMOTIVE_ANSWERS, company: { name: 'Corrida, Lda', nif: nifFrom('51777777') } };
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => request(app).post('/api/v1/assessments').set(bearer(session)).send(body)),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(responses.filter((r) => r.body.companyResolution === 'created')).toHaveLength(1);
    expect(new Set(responses.map((r) => r.body.company.id)).size).toBe(1);
    expect(await count('companies')).toBe(3);
    expect(await count('assessments')).toBe(6);
  });

  it('a conta de uma empresa não grava diagnósticos nem cria empresas', async () => {
    const session = await login('gestor@empresa-a.test');
    const own = await request(app).post('/api/v1/assessments').set(bearer(session)).send(AUTOMOTIVE_ANSWERS);
    expect(own.status).toBe(403);
    const quick = await request(app)
      .post('/api/v1/assessments')
      .set(bearer(session))
      .send({ ...AUTOMOTIVE_ANSWERS, company: { name: 'Fantasma', nif: nifFrom('59999999') } });
    expect(quick.status).toBe(403);
    expect(await count('companies')).toBe(2);
    expect(await count('assessments')).toBe(0);
    expect(await count('tasks')).toBe(0);
  });

  it('faturação no teto aceite fica gravada sem erro, e acima do teto é recusada', async () => {
    const session = await consultantForA();
    const everything = { ...AUTOMOTIVE_ANSWERS, topClientsShare: 100, carbonFootprintScope12: false };
    const atLimit = await createAssessmentAs(session, { ...everything, annualRevenue: 999_999_999_999.99 });
    expect(atLimit.commercialRevenueAtRisk).toBe(1_000_000_000_000);

    const above = await request(app)
      .post('/api/v1/assessments')
      .set(bearer(session))
      .send({ ...everything, annualRevenue: 1_000_000_000_000 });
    expect(above.status).toBe(400);
    expect(above.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sem empresa na sessão nem criação rápida responde 400', async () => {
    const session = await login('consultora@p4s.test');
    const response = await request(app).post('/api/v1/assessments').set(bearer(session)).send(AUTOMOTIVE_ANSWERS);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('COMPANY_SCOPE_REQUIRED');
  });

  it('se a inserção das tarefas falhar, nada fica gravado (nem a empresa criada na hora)', async () => {
    const session = await login('consultora@p4s.test');
    await pool.query(`
      CREATE FUNCTION fail_task_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falha simulada'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER tasks_fail BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION fail_task_insert();
    `);
    try {
      const response = await request(app)
        .post('/api/v1/assessments')
        .set(bearer(session))
        .send({ ...AUTOMOTIVE_ANSWERS, company: { name: 'Rollback, Lda', nif: nifFrom('50123456') } });
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      await pool.query('DROP TRIGGER tasks_fail ON tasks; DROP FUNCTION fail_task_insert();');
    }
    expect(await count('assessments')).toBe(0);
    expect(await count('tasks')).toBe(0);
    expect(await count('companies')).toBe(2);
  });
});

describe('isolamento multi-tenant', () => {
  let detailA: AssessmentDetail;
  let sessionB: AuthSession;

  beforeEach(async () => {
    detailA = await createAssessmentAs(await consultantForA());
    sessionB = await login('gestor@empresa-b.test');
  });

  it('a empresa B não vê a avaliação da A', async () => {
    await request(app).get(`/api/v1/assessments/${detailA.id}`).set(bearer(sessionB)).expect(404);
    const list = await request(app).get('/api/v1/assessments').set(bearer(sessionB)).expect(200);
    expect(list.body).toEqual([]);
  });

  it('a empresa B não lê, altera nem lista tarefas da A', async () => {
    const taskA = detailA.tasks[0] as Task;
    await request(app).get(`/api/v1/tasks/${taskA.id}`).set(bearer(sessionB)).expect(404);
    await request(app).put(`/api/v1/tasks/${taskA.id}`).set(bearer(sessionB)).send({ status: 'completed' }).expect(404);
    const list = await request(app).get(`/api/v1/tasks?assessment_id=${detailA.id}`).set(bearer(sessionB)).expect(200);
    expect(list.body).toEqual([]);

    const unchanged = await pool.query('SELECT status FROM tasks WHERE id = $1', [taskA.id]);
    expect(unchanged.rows[0]?.status).toBe('backlog');
  });

  it('consultor com a empresa B selecionada não elimina tarefas da A', async () => {
    const consultantB = await login('consultora@p4s.test', fx.companyB.id);
    const taskA = detailA.tasks[0] as Task;
    await request(app).delete(`/api/v1/tasks/${taskA.id}`).set(bearer(consultantB)).expect(404);
    expect(await count('tasks')).toBe(4);
  });

  it('não se cria tarefa da B numa avaliação da A', async () => {
    const consultantB = await login('consultora@p4s.test', fx.companyB.id);
    const response = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(consultantB))
      .send({ assessmentId: detailA.id, title: 'Intrusa', domain: 'ecovadis' });
    expect(response.status).toBe(404);
  });

  it('não se atribui tarefa a utilizador de outra empresa', async () => {
    const consultantA = await login('consultora@p4s.test', fx.companyA.id);
    const taskA = detailA.tasks[0] as Task;
    const response = await request(app)
      .put(`/api/v1/tasks/${taskA.id}`)
      .set(bearer(consultantA))
      .send({ assignedUserId: fx.userB.id });
    expect(response.status).toBe(400);
  });
});

describe('RBAC das tarefas', () => {
  let detail: AssessmentDetail;
  let sessionA: AuthSession;
  let consultantA: AuthSession;

  beforeEach(async () => {
    sessionA = await login('gestor@empresa-a.test');
    consultantA = await consultantForA();
    detail = await createAssessmentAs(consultantA);
  });

  it('utilizador da empresa atualiza o estado e o responsável das tarefas do diagnóstico', async () => {
    const ecovadis = taskByDomain(detail, 'ecovadis');
    const response = await request(app)
      .put(`/api/v1/tasks/${ecovadis.id}`)
      .set(bearer(sessionA))
      .send({ status: 'in_progress', assignedUserId: fx.userA.id });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'in_progress', assignedUserId: fx.userA.id, updatedBy: fx.userA.id });
  });

  it.each([
    ['o custo de uma tarefa P4S', 'ecovadis', { estimatedCost: 1 }],
    ['o custo de uma tarefa do parceiro', 'information_security', { estimatedCost: 1 }],
    ['o executor', 'ecovadis', { executorType: 'internal' }],
    ['a inclusão na proposta', 'banking_esg', { includedInProposal: false }],
    ['a fase', 'ecovadis', { phase: 'phase_2_structural' }],
    ['o título (âmbito)', 'banking_esg', { title: 'Dossier bancário + certificação TISAX, tudo incluído' }],
    ['a descrição (âmbito)', 'banking_esg', { description: 'Inclui todas as auditorias, sem custos adicionais.' }],
    ['o prazo', 'ecovadis', { deadline: '2026-11-20' }],
    ['o domínio', 'ecovadis', { domain: 'circular_economy' }],
    ['a prioridade', 'ecovadis', { priority: 'low' }],
  ] as const)('utilizador da empresa não altera %s de um entregável', async (_label, domain, patch) => {
    const task = taskByDomain(detail, domain);
    const response = await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(sessionA)).send(patch);
    expect(response.status).toBe(403);
    const stored = await request(app).get(`/api/v1/tasks/${task.id}`).set(bearer(sessionA)).expect(200);
    expect(stored.body).toEqual(task);
  });

  it('reenviar os mesmos valores não é alteração', async () => {
    const ecovadis = taskByDomain(detail, 'ecovadis');
    await request(app)
      .put(`/api/v1/tasks/${ecovadis.id}`)
      .set(bearer(sessionA))
      .send({ estimatedCost: ecovadis.estimatedCost, title: ecovadis.title, deadline: ecovadis.deadline, status: 'review' })
      .expect(200);
  });

  it('passar um entregável a Interno e voltar a P4S não deixa a empresa mexer nos termos', async () => {
    const scope3 = detail.tasks.find((t) => t.requirementCode === 'carbon_scope_3') as Task;
    await request(app).put(`/api/v1/tasks/${scope3.id}`).set(bearer(consultantA)).send({ executorType: 'internal' }).expect(200);

    for (const patch of [{ estimatedCost: 1 }, { phase: 'phase_1_urgent' }, { title: 'Outro âmbito' }, { deadline: '2026-11-20' }]) {
      await request(app).put(`/api/v1/tasks/${scope3.id}`).set(bearer(sessionA)).send(patch).expect(403);
    }

    const back = await request(app).put(`/api/v1/tasks/${scope3.id}`).set(bearer(consultantA)).send({ executorType: 'p4s' });
    expect(back.body).toMatchObject({
      executorType: 'p4s',
      estimatedCost: 3_800,
      phase: 'phase_2_structural',
      title: scope3.title,
      deadline: scope3.deadline,
      origin: 'assessment',
    });
  });

  it('numa tarefa criada pela P4S, mesmo interna, a empresa só atualiza o estado e o responsável', async () => {
    const created = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(consultantA))
      .send({ assessmentId: detail.id, title: 'Nomear interlocutor para a recolha de dados', domain: 'ecovadis', executorType: 'internal' });
    expect(created.body).toMatchObject({ origin: 'p4s', requirementCode: null, createdBy: fx.consultant.id });

    await request(app).put(`/api/v1/tasks/${created.body.id}`).set(bearer(sessionA)).send({ estimatedCost: 50 }).expect(403);
    await request(app).put(`/api/v1/tasks/${created.body.id}`).set(bearer(sessionA)).send({ status: 'completed' }).expect(200);
  });

  it('utilizador da empresa não elimina tarefas', async () => {
    const task = detail.tasks[0] as Task;
    await request(app).delete(`/api/v1/tasks/${task.id}`).set(bearer(sessionA)).expect(403);
    expect(await count('tasks')).toBe(4);
  });

  it('utilizador da empresa cria tarefas internas e gere o custo delas, mas não as passa para a P4S', async () => {
    const created = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(sessionA))
      .send({ assessmentId: detail.id, title: 'Recolher faturas de energia de 2025', domain: 'carbon_footprint' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ executorType: 'internal', origin: 'company', createdBy: fx.userA.id });

    await request(app)
      .put(`/api/v1/tasks/${created.body.id}`)
      .set(bearer(sessionA))
      .send({ estimatedCost: 300, title: 'Recolher faturas de energia de 2024 e 2025', deadline: '2026-12-15' })
      .expect(200);
    await request(app).put(`/api/v1/tasks/${created.body.id}`).set(bearer(sessionA)).send({ executorType: 'p4s' }).expect(403);
  });

  it('quando a P4S assume uma tarefa criada pela empresa, a empresa deixa de lhe alterar os termos', async () => {
    const created = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(sessionA))
      .send({ assessmentId: detail.id, title: 'Plano de redução de consumos', domain: 'carbon_footprint', estimatedCost: 500 });

    const assumed = await request(app)
      .put(`/api/v1/tasks/${created.body.id}`)
      .set(bearer(consultantA))
      .send({ executorType: 'p4s', estimatedCost: 2_900, deadline: '2027-02-15' });
    expect(assumed.body).toMatchObject({ executorType: 'p4s', estimatedCost: 2_900, deadline: '2027-02-15', origin: 'p4s' });

    await request(app).put(`/api/v1/tasks/${created.body.id}`).set(bearer(sessionA)).send({ estimatedCost: 500 }).expect(403);
    await request(app).put(`/api/v1/tasks/${created.body.id}`).set(bearer(sessionA)).send({ status: 'in_progress' }).expect(200);
  });

  it('a origem da tarefa não se define pelo pedido', async () => {
    const task = detail.tasks[0] as Task;
    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(consultantA)).send({ origin: 'company' }).expect(400);
    await request(app)
      .post('/api/v1/tasks')
      .set(bearer(sessionA))
      .send({ assessmentId: detail.id, title: 'Tarefa com origem forjada', domain: 'ecovadis', origin: 'p4s' })
      .expect(400);
  });

  it('utilizador da empresa não cria tarefas P4S', async () => {
    const response = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(sessionA))
      .send({ assessmentId: detail.id, title: 'Consultoria extra', domain: 'ecovadis', executorType: 'p4s' });
    expect(response.status).toBe(403);
  });

  it('consultor configura a proposta e o orçamento reflete-o', async () => {
    const infosec = taskByDomain(detail, 'information_security');
    const banking = taskByDomain(detail, 'banking_esg');

    await request(app).put(`/api/v1/tasks/${infosec.id}`).set(bearer(consultantA)).send({ executorType: 'internal' }).expect(200);
    await request(app).put(`/api/v1/tasks/${banking.id}`).set(bearer(consultantA)).send({ includedInProposal: false }).expect(200);
    const ecovadis = taskByDomain(detail, 'ecovadis');
    await request(app).put(`/api/v1/tasks/${ecovadis.id}`).set(bearer(consultantA)).send({ estimatedCost: 3_200 }).expect(200);

    const refreshed = await request(app).get(`/api/v1/assessments/${detail.id}`).set(bearer(consultantA)).expect(200);
    // Fase 1: só EcoVadis 3.200 (TISAX passou a interno, banca saiu). Fase 2: Âmbito 3 3.800.
    expect(refreshed.body.remediationSummary).toMatchObject({ phase1Cost: 3_200, phase2Cost: 3_800, totalInvestment: 7_000 });
  });

  it('consultor elimina tarefas', async () => {
    const task = detail.tasks[0] as Task;
    await request(app).delete(`/api/v1/tasks/${task.id}`).set(bearer(consultantA)).expect(204);
    await request(app).get(`/api/v1/tasks/${task.id}`).set(bearer(consultantA)).expect(404);
  });

  it('PUT vazio é recusado', async () => {
    const task = detail.tasks[0] as Task;
    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(consultantA)).send({}).expect(400);
  });
});

describe('filtros de tarefas', () => {
  let session: AuthSession;

  beforeEach(async () => {
    await createAssessmentAs(await consultantForA());
    session = await login('gestor@empresa-a.test');
  });

  it.each([
    ['priority=critical', 2],
    ['executor_type=partner', 1],
    ['executor_type=p4s', 3],
    ['phase=phase_2_structural', 1],
    ['domain=carbon_footprint', 1],
    ['status=backlog&priority=high', 2],
  ])('?%s → %d tarefas', async (query, expected) => {
    const response = await request(app).get(`/api/v1/tasks?${query}`).set(bearer(session)).expect(200);
    expect(response.body).toHaveLength(expected);
  });

  it.each(['status=bogus', 'executor_type=freelancer', 'unknown=1', 'assessment_id=abc'])('?%s → 400', async (query) => {
    await request(app).get(`/api/v1/tasks?${query}`).set(bearer(session)).expect(400);
  });

  it('ordena Fase 1 antes da Fase 2 e críticas primeiro', async () => {
    const response = await request(app).get('/api/v1/tasks').set(bearer(session)).expect(200);
    const tasks = response.body as Task[];
    expect(tasks.map((t) => [t.phase, t.priority])).toEqual([
      ['phase_1_urgent', 'critical'],
      ['phase_1_urgent', 'critical'],
      ['phase_1_urgent', 'high'],
      ['phase_2_structural', 'high'],
    ]);
  });
});

describe('empresas', () => {
  it('a equipa P4S regista empresas e o NIF é único', async () => {
    const session = await login('consultora@p4s.test');
    const body = { name: 'Metalomecânica Exemplo, Lda', nif: nifFrom('50777777'), cae: '25620' };
    const created = await request(app).post('/api/v1/companies').set(bearer(session)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.sectorProfile).toBe('general_industrial');
    await request(app).post('/api/v1/companies').set(bearer(session)).send(body).expect(409);
    await request(app).post('/api/v1/companies').set(bearer(session)).send({ ...body, nif: '500000001' }).expect(400);
  });

  it('utilizador da empresa só vê a sua', async () => {
    const session = await login('gestor@empresa-a.test');
    await request(app).get(`/api/v1/companies/${fx.companyA.id}`).set(bearer(session)).expect(200);
    await request(app).get(`/api/v1/companies/${fx.companyB.id}`).set(bearer(session)).expect(404);
    await request(app).get('/api/v1/companies').set(bearer(session)).expect(403);
    await request(app)
      .post('/api/v1/companies')
      .set(bearer(session))
      .send({ name: 'X', nif: nifFrom('50888888'), cae: '25620' })
      .expect(403);
  });

  it('lista responsáveis possíveis (utilizadores ativos da empresa e equipa P4S) sem emails nem papéis', async () => {
    const session = await login('gestor@empresa-a.test');
    const response = await request(app).get('/api/v1/companies/current/users').set(bearer(session)).expect(200);
    const users = response.body as AssignableUser[];
    expect(users.map((u) => [u.fullName, u.team]).sort()).toEqual([
      ['Admin P4S', 'p4s'],
      ['Consultora P4S', 'p4s'],
      ['Gestor A', 'company'],
    ]);
    expect(users.every((u) => Object.keys(u).sort().join() === 'fullName,id,team')).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/@|admin|consultant/);
  });

  it('a equipa P4S corrige os dados de uma empresa', async () => {
    const session = await login('consultora@p4s.test');
    const updated = await request(app)
      .put(`/api/v1/companies/${fx.companyA.id}`)
      .set(bearer(session))
      .send({ name: 'Moldes Exemplo A, SA', cae: '25734', annualRevenue: 7_100_000 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Moldes Exemplo A, SA', annualRevenue: 7_100_000, nif: fx.companyA.nif });
    expect(new Date(updated.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(fx.companyA.updatedAt).getTime());

    await request(app).put(`/api/v1/companies/${fx.companyA.id}`).set(bearer(session)).send({ nif: fx.companyB.nif }).expect(409);
    await request(app).put(`/api/v1/companies/${fx.companyA.id}`).set(bearer(session)).send({}).expect(400);
    await request(app).put(`/api/v1/companies/${fx.companyA.id}`).set(bearer(session)).send({ nif: '000000000' }).expect(400);
    await request(app)
      .put('/api/v1/companies/00000000-0000-4000-8000-000000000000')
      .set(bearer(session))
      .send({ name: 'Não existe' })
      .expect(404);
  });

  it('a conta de uma empresa não altera os dados da empresa', async () => {
    const session = await login('gestor@empresa-a.test');
    await request(app).put(`/api/v1/companies/${fx.companyA.id}`).set(bearer(session)).send({ name: 'Outro nome' }).expect(403);
  });
});

describe('GET /api/v1/catalog (pesos e preços só para a equipa P4S)', () => {
  it('recusa pedidos sem sessão', async () => {
    const response = await request(app).get('/api/v1/catalog');
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toMatch(/weightPoints|estimatedCost/);
  });

  it('recusa a conta de uma empresa', async () => {
    const response = await request(app).get('/api/v1/catalog').set(bearer(await login('gestor@empresa-a.test')));
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toMatch(/weightPoints|estimatedCost/);
  });

  it('devolve o catálogo à equipa P4S, sem ficar em cache', async () => {
    const response = await request(app).get('/api/v1/catalog').set(bearer(await login('consultora@p4s.test')));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.spreadPenaltyBps).toBe(40);
    expect(response.body.parameters.ecovadis.task.estimatedCost).toBe(3500);
    expect(response.body.dealbreakers).toHaveLength(2);
  });
});

describe('infraestrutura', () => {
  it('rota inexistente responde 404 em JSON', async () => {
    const response = await request(app).get('/api/v1/nada').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('health check', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });
});
