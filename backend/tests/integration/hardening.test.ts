// Sessão, limites de tentativas, pedidos mal formados, cabeçalhos e validade da proposta.

import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/config/database.js';
import type { AssessmentDetail, AssessmentListEntry, AuthSession, CreatedAssessment } from '../../src/models/api.types.js';
import type { Task } from '../../src/models/domain.js';
import { addDays, todayInLisbon } from '../../src/utils/dates.js';
import {
  AUTOMOTIVE_ANSWERS,
  PASSWORD,
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

const SECRET = process.env.JWT_SECRET as string;
const sign = (claims: Record<string, unknown>) =>
  jwt.sign(claims, SECRET, { algorithm: 'HS256', issuer: 'p4s-stress-test', expiresIn: 600 });
const asBearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const consultantForA = () => login('consultora@p4s.test', fx.companyA.id);

async function createAssessment(session: AuthSession, body: Record<string, unknown> = AUTOMOTIVE_ANSWERS) {
  const response = await request(app).post('/api/v1/assessments').set(bearer(session)).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as CreatedAssessment;
}

describe('sessão', () => {
  it('terminar a sessão invalida de imediato o token de acesso e o de renovação', async () => {
    const session = await login('gestor@empresa-a.test');
    const otherDevice = await login('gestor@empresa-a.test');
    await request(app).get('/api/v1/tasks').set(bearer(session)).expect(200);

    await request(app).post('/api/v1/auth/logout').set(bearer(session)).expect(204);

    await request(app).get('/api/v1/tasks').set(bearer(session)).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    // Terminar a sessão termina-a em todos os dispositivos.
    await request(app).get('/api/v1/tasks').set(bearer(otherDevice)).expect(401);
    // Quem tem a palavra-passe volta a entrar.
    await request(app).get('/api/v1/tasks').set(bearer(await login('gestor@empresa-a.test'))).expect(200);
  });

  it('terminar a sessão exige sessão', async () => {
    await request(app).post('/api/v1/auth/logout').expect(401);
  });

  it('um token bem assinado para um utilizador que não existe é recusado', async () => {
    const forged = sign({
      typ: 'access',
      userId: '00000000-0000-4000-8000-000000000000',
      companyId: fx.companyA.id,
      role: 'admin',
      tv: 0,
    });
    await request(app).get('/api/v1/companies').set(asBearer(forged)).expect(401);
    await request(app).get('/api/v1/tasks').set(asBearer(forged)).expect(401);
    await request(app).get('/api/v1/catalog').set(asBearer(forged)).expect(401);
  });

  it('o papel e a empresa que valem são os da base de dados, não os que vêm no token', async () => {
    const promoted = sign({ typ: 'access', userId: fx.userA.id, companyId: fx.companyA.id, role: 'admin', tv: 0 });
    await request(app).get('/api/v1/companies').set(asBearer(promoted)).expect(403);
    await request(app).get('/api/v1/catalog').set(asBearer(promoted)).expect(403);

    const moved = sign({ typ: 'access', userId: fx.userA.id, companyId: fx.companyB.id, role: 'company_user', tv: 0 });
    await request(app).get('/api/v1/tasks').set(asBearer(moved)).expect(401);
  });

  it('desativar uma conta corta o acesso no pedido seguinte', async () => {
    const session = await login('gestor@empresa-a.test');
    await request(app)
      .put(`/api/v1/users/${fx.userA.id}`)
      .set(bearer(await consultantForA()))
      .send({ isActive: false })
      .expect(200);
    await request(app).get('/api/v1/tasks').set(bearer(session)).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
  });

  it('mudar a palavra-passe termina as outras sessões e mantém a de quem a mudou', async () => {
    const session = await login('gestor@empresa-a.test');
    const otherDevice = await login('gestor@empresa-a.test');
    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(session))
      .send({ currentPassword: PASSWORD, newPassword: 'Outra-palavra-passe-456' });
    expect(changed.status).toBe(200);

    await request(app).get('/api/v1/tasks').set(bearer(otherDevice)).expect(401);
    await request(app).get('/api/v1/tasks').set(bearer(session)).expect(401);
    await request(app).get('/api/v1/tasks').set(bearer(changed.body as AuthSession)).expect(200);
  });

  it('uma sessão renova-se mantendo a data de início e deixa de se renovar ao fim da duração máxima', async () => {
    const session = await login('gestor@empresa-a.test');
    const claims = jwt.decode(session.refreshToken) as { sst: number; tv: number };
    expect(claims.sst).toBeGreaterThan(0);

    const renewed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(renewed.status).toBe(200);
    expect((jwt.decode(renewed.body.refreshToken) as { sst: number }).sst).toBe(claims.sst);

    const startedLongAgo = sign({
      typ: 'refresh',
      userId: fx.userA.id,
      companyId: fx.companyA.id,
      tv: claims.tv,
      sst: Math.floor(Date.now() / 1000) - 31 * 86_400,
    });
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: startedLongAgo });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/expirada/);
  });
});

describe('limite de tentativas de login', () => {
  it('dez tentativas erradas contra uma conta bloqueiam essa conta, e não as outras pessoas do mesmo endereço', async () => {
    process.env.RATE_LIMIT_IN_TESTS = 'on';
    try {
      const attempt = (email: string, password: string) =>
        request(app).post('/api/v1/auth/login').send({ email, password });

      for (let i = 0; i < 10; i += 1) expect((await attempt('admin@p4s.test', 'errada')).status).toBe(401);
      const blocked = await attempt('admin@p4s.test', 'errada');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
      // Com a chave certa a conta atacada também espera, mas só ela.
      expect((await attempt('admin@p4s.test', PASSWORD)).status).toBe(429);
      expect((await attempt('ADMIN@p4s.test ', PASSWORD)).status).toBe(429);
      expect((await attempt('consultora@p4s.test', PASSWORD)).status).toBe(200);
      expect((await attempt('gestor@empresa-a.test', PASSWORD)).status).toBe(200);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});

describe('pedidos mal formados', () => {
  it('corpo comprimido ilegível responde 400, e não erro interno', async () => {
    const response = await request(app)
      .post('/api/v1/assessments/simulate')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send('isto não é gzip');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('parâmetro mal codificado responde 400', async () => {
    const response = await request(app).get('/api/v1/tasks/%E0%A4%A').set(bearer(await consultantForA()));
    expect(response.status).toBe(400);
  });

  it('caracteres de controlo em textos são recusados na validação', async () => {
    const session = await consultantForA();
    const detail = await createAssessment(session);
    const task = detail.tasks[0] as Task;

    const title = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(session))
      .send({ assessmentId: detail.id, title: 'abc\u0000def', domain: 'ecovadis' });
    expect(title.status).toBe(400);
    expect(title.body.error.code).toBe('VALIDATION_ERROR');

    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(session)).send({ description: 'x\u0000y' }).expect(400);
    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(session)).send({ title: 'duas\nlinhas' }).expect(400);
    await request(app)
      .post('/api/v1/companies')
      .set(bearer(session))
      .send({ name: 'a\u0000b', nif: nifFrom('50666666'), cae: '25620' })
      .expect(400);
    // Uma descrição com parágrafos continua a ser aceite.
    await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(bearer(session))
      .send({ description: 'Primeiro parágrafo.\n\nSegundo parágrafo.' })
      .expect(200);
  });

  it('as mensagens de validação chegam em português', async () => {
    const session = await consultantForA();
    const detail = await createAssessment(session);

    const tooLong = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(session))
      .send({ assessmentId: detail.id, title: 'x'.repeat(300), domain: 'ecovadis' });
    expect(tooLong.body.error.details).toEqual([{ path: 'title', message: 'Máximo 255 caracteres.' }]);

    const unknownKey = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(session))
      .send({ assessmentId: detail.id, title: 'Tarefa', domain: 'ecovadis', extra: true });
    expect(unknownKey.body.error.details[0].message).toMatch(/^Chave inválida/);

    const wrongType = await request(app)
      .post('/api/v1/assessments/simulate')
      .send({ sectorProfile: 'general_industrial', annualRevenue: 'muito', ...AUTOMOTIVE_ANSWERS });
    expect(wrongType.body.error.details[0].message).toMatch(/^Entrada inválida/);
  });

  it('um NIF que começa por zero é recusado', async () => {
    const response = await request(app)
      .post('/api/v1/companies')
      .set(bearer(await consultantForA()))
      .send({ name: 'Zeros, Lda', nif: '000000000', cae: '25620' });
    expect(response.status).toBe(400);
  });

  it('o email é único sem distinguir maiúsculas, também na base de dados', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (company_id, email, password_hash, full_name, role)
         VALUES ($1, 'GESTOR@EMPRESA-A.TEST', 'x', 'Duplicado', 'company_user')`,
        [fx.companyA.id],
      ),
    ).rejects.toThrow(/users_email_lower_key/);
  });
});

describe('cabeçalhos', () => {
  it('as respostas da API não ficam em cache, com ou sem sessão', async () => {
    const session = await login('gestor@empresa-a.test');
    const me = await request(app).get('/api/v1/auth/me').set(bearer(session)).expect(200);
    expect(me.headers['cache-control']).toBe('no-store');
    const tasks = await request(app).get('/api/v1/tasks').set(bearer(session)).expect(200);
    expect(tasks.headers['cache-control']).toBe('no-store');
    const denied = await request(app).get('/api/v1/tasks').expect(401);
    expect(denied.headers['cache-control']).toBe('no-store');
  });

  it('por omissão o browser é instruído a usar HTTPS, e o HSTS não abrange subdomínios', async () => {
    const response = await request(app).get('/health').expect(200);
    const csp = response.headers['content-security-policy'] as string;
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/upgrade-insecure-requests/);
    expect(response.headers['strict-transport-security']).toBe('max-age=15552000');
  });

  it('com ALLOW_INSECURE_HTTP a aplicação abre por HTTP simples numa rede local', async () => {
    const response = await request(createApp({ allowInsecureHttp: true })).get('/health').expect(200);
    const csp = response.headers['content-security-policy'] as string;
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
  });
});

describe('validade da proposta', () => {
  let consultant: AuthSession;
  let client: AuthSession;
  let detail: CreatedAssessment;
  const today = todayInLisbon();

  const backdate = (days: number) =>
    pool.query(`UPDATE assessments SET proposal_issued_at = proposal_issued_at - make_interval(days => $2) WHERE id = $1`, [
      detail.id,
      days,
    ]);

  beforeEach(async () => {
    consultant = await consultantForA();
    client = await login('gestor@empresa-a.test');
    detail = await createAssessment(consultant);
  });

  it('a proposta fica emitida no dia do diagnóstico e vale 30 dias', () => {
    expect(detail.proposal).toEqual({
      issuedOn: today,
      validUntil: addDays(today, 30),
      validityDays: 30,
      expired: false,
    });
  });

  it('no último dia ainda é válida e no dia seguinte expira, para quem quer que a abra', async () => {
    await backdate(30);
    const lastDay = await request(app).get(`/api/v1/assessments/${detail.id}`).set(bearer(client)).expect(200);
    expect(lastDay.body.proposal).toMatchObject({ validUntil: today, expired: false });

    await backdate(1);
    const expired = await request(app).get(`/api/v1/assessments/${detail.id}`).set(bearer(client)).expect(200);
    expect(expired.body.proposal).toEqual({
      issuedOn: addDays(today, -31),
      validUntil: addDays(today, -1),
      validityDays: 30,
      expired: true,
    });
    const list = await request(app).get('/api/v1/assessments').set(bearer(client)).expect(200);
    expect((list.body as AssessmentListEntry[])[0]?.proposal.expired).toBe(true);
  });

  it('a P4S reemite: a validade recomeça e os entregáveis por começar deslizam os mesmos dias', async () => {
    const started = detail.tasks.find((t) => t.requirementCode === 'ecovadis') as Task;
    await request(app).put(`/api/v1/tasks/${started.id}`).set(bearer(consultant)).send({ status: 'in_progress' }).expect(200);
    const internal = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(client))
      .send({ assessmentId: detail.id, title: 'Recolher faturas de energia', domain: 'carbon_footprint', deadline: addDays(today, 10) });
    await backdate(40);

    const response = await request(app)
      .post(`/api/v1/assessments/${detail.id}/reissue-proposal`)
      .set(bearer(consultant))
      .expect(200);

    expect(response.body.proposal).toEqual({ issuedOn: today, validUntil: addDays(today, 30), validityDays: 30, expired: false });
    const after = new Map((response.body.tasks as Task[]).map((t) => [t.id, t]));
    for (const before of detail.tasks) {
      const expected = before.id === started.id ? before.deadline : addDays(before.deadline as string, 40);
      expect(after.get(before.id)?.deadline, before.title).toBe(expected);
    }
    // As tarefas internas da empresa não são entregáveis da proposta: ficam como estão.
    expect(after.get(internal.body.id)?.deadline).toBe(addDays(today, 10));
  });

  it('reemitir no próprio dia não mexe nos prazos', async () => {
    const response = await request(app)
      .post(`/api/v1/assessments/${detail.id}/reissue-proposal`)
      .set(bearer(consultant))
      .expect(200);
    expect((response.body.tasks as Task[]).map((t) => t.deadline)).toEqual(detail.tasks.map((t) => t.deadline));
  });

  it('a conta de uma empresa não reemite propostas nem elimina diagnósticos', async () => {
    await request(app).post(`/api/v1/assessments/${detail.id}/reissue-proposal`).set(bearer(client)).expect(403);
    await request(app).delete(`/api/v1/assessments/${detail.id}`).set(bearer(client)).expect(403);
  });

  it('com outra empresa selecionada, a P4S não reemite nem elimina diagnósticos desta', async () => {
    const consultantB = await login('consultora@p4s.test', fx.companyB.id);
    await request(app).post(`/api/v1/assessments/${detail.id}/reissue-proposal`).set(bearer(consultantB)).expect(404);
    await request(app).delete(`/api/v1/assessments/${detail.id}`).set(bearer(consultantB)).expect(404);
    await request(app).get(`/api/v1/assessments/${detail.id}`).set(bearer(consultant)).expect(200);
  });

  it('a P4S elimina um diagnóstico e as tarefas dele', async () => {
    const other = await createAssessment(consultant);
    await request(app).delete(`/api/v1/assessments/${detail.id}`).set(bearer(consultant)).expect(204);

    await request(app).get(`/api/v1/assessments/${detail.id}`).set(bearer(consultant)).expect(404);
    const remaining = await request(app).get('/api/v1/tasks').set(bearer(consultant)).expect(200);
    expect((remaining.body as Task[]).every((t) => t.assessmentId === other.id)).toBe(true);
    expect(remaining.body).toHaveLength(other.tasks.length);
    await request(app).delete(`/api/v1/assessments/${detail.id}`).set(bearer(consultant)).expect(404);
  });
});

describe('diagnósticos sem fotografia do cálculo (rascunhos e versões anteriores)', () => {
  it('não se abrem, a lista assinala-os e a P4S consegue eliminá-los', async () => {
    const consultant = await consultantForA();
    const good = await createAssessment(consultant);
    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO assessments (company_id, status, completed_at) VALUES ($1, 'completed', CURRENT_TIMESTAMP) RETURNING id`,
      [fx.companyA.id],
    );
    const draft = await pool.query<{ id: string }>(`INSERT INTO assessments (company_id) VALUES ($1) RETURNING id`, [
      fx.companyA.id,
    ]);
    const legacyId = legacy.rows[0]?.id as string;
    const draftId = draft.rows[0]?.id as string;

    const list = await request(app).get('/api/v1/assessments').set(bearer(consultant)).expect(200);
    const openable = new Map((list.body as AssessmentListEntry[]).map((entry) => [entry.id, entry.openable]));
    expect(openable.get(good.id)).toBe(true);
    expect(openable.get(legacyId)).toBe(false);
    expect(openable.get(draftId)).toBe(false);

    for (const id of [legacyId, draftId]) {
      const response = await request(app).get(`/api/v1/assessments/${id}`).set(bearer(consultant));
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ASSESSMENT_NOT_OPENABLE');
      await request(app).post(`/api/v1/assessments/${id}/reissue-proposal`).set(bearer(consultant)).expect(409);
    }
    await request(app).delete(`/api/v1/assessments/${legacyId}`).set(bearer(consultant)).expect(204);
  });
});

describe('lacunas e entregáveis do plano', () => {
  let consultant: AuthSession;
  let client: AuthSession;
  let detail: CreatedAssessment;
  const today = todayInLisbon();

  beforeEach(async () => {
    consultant = await consultantForA();
    client = await login('gestor@empresa-a.test');
    detail = await createAssessment(consultant);
  });

  it('o diagnóstico diz quem o gravou', async () => {
    expect(detail.conductedByName).toBe('Consultora P4S');
    const reopened = await request(app).get(`/api/v1/assessments/${detail.id}`).set(bearer(client)).expect(200);
    expect((reopened.body as AssessmentDetail).conductedByName).toBe('Consultora P4S');
  });

  it('a P4S repõe o entregável-tipo de uma lacuna cujo entregável foi eliminado', async () => {
    const ecovadis = detail.tasks.find((t) => t.requirementCode === 'ecovadis') as Task;
    await request(app).put(`/api/v1/tasks/${ecovadis.id}`).set(bearer(consultant)).send({ estimatedCost: 2_900 }).expect(200);
    await request(app).delete(`/api/v1/tasks/${ecovadis.id}`).set(bearer(consultant)).expect(204);

    const restored = await request(app)
      .post(`/api/v1/assessments/${detail.id}/deliverables/ecovadis/restore`)
      .set(bearer(consultant));
    expect(restored.status).toBe(201);
    // Volta com os termos da fotografia do diagnóstico, não com os que tinham sido negociados.
    expect(restored.body).toMatchObject({
      requirementCode: 'ecovadis',
      origin: 'assessment',
      title: ecovadis.title,
      description: ecovadis.description,
      estimatedCost: 3_500,
      phase: 'phase_1_urgent',
      priority: 'critical',
      executorType: 'p4s',
      includedInProposal: true,
      status: 'backlog',
      deadline: addDays(today, 60),
      createdBy: fx.consultant.id,
    });

    const again = await request(app)
      .post(`/api/v1/assessments/${detail.id}/deliverables/ecovadis/restore`)
      .set(bearer(consultant));
    expect(again.status).toBe(409);
  });

  it('só se repõe o que o diagnóstico deu como lacuna, e só a P4S o faz', async () => {
    // Âmbitos 1 e 2 estavam conformes nestas respostas: não há entregável para repor.
    await request(app)
      .post(`/api/v1/assessments/${detail.id}/deliverables/carbon_scope_1_2/restore`)
      .set(bearer(consultant))
      .expect(404);
    await request(app).post(`/api/v1/assessments/${detail.id}/deliverables/outra_coisa/restore`).set(bearer(consultant)).expect(400);
    await request(app).post(`/api/v1/assessments/${detail.id}/deliverables/ecovadis/restore`).set(bearer(client)).expect(403);
    const consultantB = await login('consultora@p4s.test', fx.companyB.id);
    await request(app).post(`/api/v1/assessments/${detail.id}/deliverables/ecovadis/restore`).set(bearer(consultantB)).expect(404);
  });

  it('a base de dados não aceita dois entregáveis para a mesma lacuna', async () => {
    await expect(
      pool.query(
        `INSERT INTO tasks (assessment_id, company_id, title, domain, requirement_code, origin)
         VALUES ($1, $2, 'Duplicado', 'ecovadis', 'ecovadis', 'assessment')`,
        [detail.id, fx.companyA.id],
      ),
    ).rejects.toThrow(/tasks_one_per_requirement/);
  });

  it('um entregável da P4S incluído na proposta precisa de prazo', async () => {
    const withoutDeadline = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(consultant))
      .send({ assessmentId: detail.id, title: 'Formação da equipa de qualidade', domain: 'ecovadis', estimatedCost: 900 });
    expect(withoutDeadline.status).toBe(400);
    expect(withoutDeadline.body.error.message).toMatch(/prazo/);

    // Fora da proposta, ou a cargo da empresa, o prazo pode ficar por definir.
    const outside = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(consultant))
      .send({ assessmentId: detail.id, title: 'Formação da equipa de qualidade', domain: 'ecovadis', includedInProposal: false });
    expect(outside.status).toBe(201);
    const internal = await request(app)
      .post('/api/v1/tasks')
      .set(bearer(client))
      .send({ assessmentId: detail.id, title: 'Recolher faturas de energia', domain: 'carbon_footprint' });
    expect(internal.status).toBe(201);

    // Passar a incluir, ou passar para a P4S, sem prazo é recusado. Com prazo passa.
    await request(app).put(`/api/v1/tasks/${outside.body.id}`).set(bearer(consultant)).send({ includedInProposal: true }).expect(400);
    await request(app).put(`/api/v1/tasks/${internal.body.id}`).set(bearer(consultant)).send({ executorType: 'p4s' }).expect(400);
    await request(app)
      .put(`/api/v1/tasks/${outside.body.id}`)
      .set(bearer(consultant))
      .send({ includedInProposal: true, deadline: addDays(today, 45) })
      .expect(200);
    // E não se tira o prazo a um entregável da proposta.
    const ecovadis = detail.tasks.find((t) => t.requirementCode === 'ecovadis') as Task;
    await request(app).put(`/api/v1/tasks/${ecovadis.id}`).set(bearer(consultant)).send({ deadline: null }).expect(400);
  });

  it('uma tarefa antiga sem prazo continua a poder mudar de estado', async () => {
    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO tasks (assessment_id, company_id, title, domain, executor_type, origin)
       VALUES ($1, $2, 'Entregável antigo sem prazo', 'ecovadis', 'p4s', 'p4s') RETURNING id`,
      [detail.id, fx.companyA.id],
    );
    await request(app).put(`/api/v1/tasks/${legacy.rows[0]?.id}`).set(bearer(client)).send({ status: 'in_progress' }).expect(200);
  });

  it('a ficha da empresa acompanha o setor e a faturação do último diagnóstico', async () => {
    await createAssessment(consultant, { ...AUTOMOTIVE_ANSWERS, sectorProfile: 'heavy_process', annualRevenue: 8_250_000 });
    const company = await request(app).get(`/api/v1/companies/${fx.companyA.id}`).set(bearer(consultant)).expect(200);
    expect(company.body).toMatchObject({ sectorProfile: 'heavy_process', annualRevenue: 8_250_000, name: fx.companyA.name });
  });
});

describe('aplicação servida no mesmo processo', () => {
  it('o estado de saúde reflete a base de dados', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });
});
