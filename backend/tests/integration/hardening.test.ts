// Sessão, limites de tentativas, pedidos mal formados, cabeçalhos e validade da proposta.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

    await request(app).post('/api/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(204);

    await request(app).get('/api/v1/tasks').set(bearer(session)).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    // Terminar a sessão termina-a em todos os dispositivos.
    await request(app).get('/api/v1/tasks').set(bearer(otherDevice)).expect(401);
    // Quem tem a palavra-passe volta a entrar.
    await request(app).get('/api/v1/tasks').set(bearer(await login('gestor@empresa-a.test'))).expect(200);
  });

  it('terminar a sessão exige a sessão de quem sai, e não se faz com um token de acesso', async () => {
    const session = await login('gestor@empresa-a.test');
    await request(app).post('/api/v1/auth/logout').expect(400);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'nao-e-um-token' }).expect(401);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: session.accessToken }).expect(401);
    // Nenhuma das tentativas terminou a sessão.
    await request(app).get('/api/v1/tasks').set(bearer(session)).expect(200);
    // Uma sessão já terminada não se termina outra vez.
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(204);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(401);
  });

  it('«Sair» termina a sessão mesmo com o token de acesso já expirado', async () => {
    const session = await login('gestor@empresa-a.test');
    const otherDevice = await login('gestor@empresa-a.test');
    // O separador esteve parado: o token de acesso expirou, o de renovação continua válido.
    const expired = jwt.sign(
      { typ: 'access', userId: fx.userA.id, companyId: fx.companyA.id, role: 'company_user', tv: 0 },
      SECRET,
      { algorithm: 'HS256', issuer: 'p4s-stress-test', expiresIn: -60 },
    );
    await request(app).get('/api/v1/tasks').set(asBearer(expired)).expect(401);

    await request(app)
      .post('/api/v1/auth/logout')
      .set(asBearer(expired))
      .send({ refreshToken: session.refreshToken })
      .expect(204);

    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: otherDevice.refreshToken }).expect(401);
    await request(app).get('/api/v1/tasks').set(bearer(otherDevice)).expect(401);
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
    // Separador de linha do Unicode e marcas que invertem a direção do texto.
    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(session)).send({ title: 'duas\u2028linhas' }).expect(400);
    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(session)).send({ title: 'Dossier \u202Eodatrevni' }).expect(400);
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

  it('um prazo fora de um intervalo com sentido é recusado, e o teto dos valores diz o valor certo', async () => {
    const session = await consultantForA();
    const detail = await createAssessment(session);
    const task = detail.tasks[0] as Task;

    const farAway = await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(session)).send({ deadline: '9999-12-31' });
    expect(farAway.status).toBe(400);
    expect(farAway.body.error.details).toEqual([{ path: 'deadline', message: 'O prazo tem de estar entre 2000 e 2100.' }]);
    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(session)).send({ deadline: '1999-12-31' }).expect(400);
    await request(app).put(`/api/v1/tasks/${task.id}`).set(bearer(session)).send({ deadline: '2100-12-31' }).expect(200);

    const tooMuch = await request(app)
      .post('/api/v1/assessments/simulate')
      .send({ ...AUTOMOTIVE_ANSWERS, sectorProfile: 'general_industrial', annualRevenue: 1_000_000_000_000 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.details[0].message.replace(/\s/g, ' ')).toBe('Máximo 999.999.999.999,99 €.');
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
  let today: string;

  // Recua por dias de calendário de Lisboa (meio-dia desse dia). Com um intervalo de N vezes
  // 24 horas, o resultado mudava de dia perto da meia-noite nas semanas a seguir à mudança de hora.
  const backdate = (days: number) =>
    pool.query(
      `UPDATE assessments
       SET proposal_issued_at = (((proposal_issued_at AT TIME ZONE 'Europe/Lisbon')::date - $2::int) + time '12:00') AT TIME ZONE 'Europe/Lisbon'
       WHERE id = $1`,
      [detail.id, days],
    );

  beforeEach(async () => {
    today = todayInLisbon();
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

  it('a P4S reemite: a validade recomeça e os entregáveis por concluir deslizam os mesmos dias', async () => {
    // O estado é um campo que a empresa altera: pôr um entregável «em curso» não lhe fixa o prazo.
    const started = detail.tasks.find((t) => t.requirementCode === 'ecovadis') as Task;
    await request(app).put(`/api/v1/tasks/${started.id}`).set(bearer(client)).send({ status: 'in_progress' }).expect(200);
    const done = detail.tasks.find((t) => t.requirementCode === 'carbon_scope_3') as Task;
    await request(app).put(`/api/v1/tasks/${done.id}`).set(bearer(consultant)).send({ status: 'completed' }).expect(200);
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
      // O que já foi entregue fica com a data em que foi prometido.
      const expected = before.id === done.id ? before.deadline : addDays(before.deadline as string, 40);
      expect(after.get(before.id)?.deadline, before.title).toBe(expected);
    }
    // Fica registado quem deslocou os prazos: a consultora, e não a conta da empresa que só mudou o estado.
    expect(after.get(started.id)?.updatedBy).toBe(fx.consultant.id);
    expect(after.get(done.id)?.updatedBy).toBe(fx.consultant.id);
    // Nenhum entregável por concluir fica com prazo anterior à nova data de emissão.
    for (const task of response.body.tasks as Task[]) {
      if (task.status !== 'completed' && task.executorType !== 'internal') {
        expect((task.deadline as string) >= today, task.title).toBe(true);
      }
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
  let today: string;

  beforeEach(async () => {
    today = todayInLisbon();
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

  describe('ao eliminar um diagnóstico', () => {
    const sheet = async () => (await request(app).get(`/api/v1/companies/${fx.companyA.id}`).set(bearer(consultant)).expect(200)).body;
    const remove = (id: string) => request(app).delete(`/api/v1/assessments/${id}`).set(bearer(consultant)).expect(204);
    const WRONG = { ...AUTOMOTIVE_ANSWERS, sectorProfile: 'general_industrial', annualRevenue: 25_000_000 };

    it('enganado, a ficha volta ao setor e à faturação que tinha', async () => {
      const mistaken = await createAssessment(consultant, WRONG);
      expect(await sheet()).toMatchObject({ sectorProfile: 'general_industrial', annualRevenue: 25_000_000 });

      await remove(mistaken.id);

      expect(await sheet()).toMatchObject({ sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 });
      // O diagnóstico seguinte volta a partir dos dados certos.
      const next = await createAssessment(consultant);
      expect(next.sectorProfile).toBe('automotive_molds');
      expect(next.snapshot.input.annualRevenue).toBe(6_500_000);
    });

    it('gravado antes de a ficha anterior ficar registada, a ficha volta ao que o diagnóstico anterior lhe deu', async () => {
      const mistaken = await createAssessment(consultant, WRONG);
      await pool.query(`UPDATE assessments SET raw_responses = raw_responses - 'companyBefore' WHERE id = $1`, [mistaken.id]);
      await remove(mistaken.id);
      expect(await sheet()).toMatchObject({ sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 });
    });

    it('a ficha corrigida à mão depois do diagnóstico fica como está', async () => {
      const mistaken = await createAssessment(consultant, WRONG);
      await request(app)
        .put(`/api/v1/companies/${fx.companyA.id}`)
        .set(bearer(consultant))
        .send({ annualRevenue: 7_000_000 })
        .expect(200);
      await remove(mistaken.id);
      expect(await sheet()).toMatchObject({ sectorProfile: 'general_industrial', annualRevenue: 7_000_000 });
    });

    it('que não é o mais recente, a ficha continua a acompanhar o mais recente', async () => {
      const latest = await createAssessment(consultant, WRONG);
      await remove(detail.id);
      expect(await sheet()).toMatchObject({ sectorProfile: 'general_industrial', annualRevenue: 25_000_000 });
      expect(latest.snapshot.companyBefore).toEqual({ sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 });
    });
  });
});

describe('aplicação servida no mesmo processo', () => {
  let staticDir: string;
  let served: ReturnType<typeof createApp>;

  beforeAll(async () => {
    staticDir = await mkdtemp(path.join(tmpdir(), 'p4s-static-'));
    await mkdir(path.join(staticDir, 'assets'));
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><div id="root"></div>');
    await writeFile(path.join(staticDir, 'assets', 'app.js'), 'console.log("app")');
    served = createApp({ staticDir });
  });

  afterAll(async () => {
    await rm(staticDir, { recursive: true, force: true });
  });

  it('o estado de saúde reflete a base de dados', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  it.each(['/', '/plano', '/plano/8d6e7177-8706-4389-aded-5b5cb5fd9142', '/entrar?next=/plano', '/plano/..%2Ftasks', '/utilizadores/a.b'])(
    'o ecrã %s recebe a aplicação',
    async (url) => {
      const response = await request(served).get(url).expect(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('<div id="root">');
    },
  );

  it('HEAD a um ecrã responde como GET, sem corpo', async () => {
    const response = await request(served).head('/plano').expect(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('serve os ficheiros que existem e responde 404 aos que não existem', async () => {
    const script = await request(served).get('/assets/app.js').expect(200);
    expect(script.headers['content-type']).toMatch(/javascript/);
    const missing = await request(served).get('/assets/nao-existe.js').expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    await request(served).get('/favicon.ico').expect(404);
  });

  it('sem a interface compilada responde 503 e não culpa quem pede', async () => {
    const missing = createApp({ staticDir: path.join(staticDir, 'nao-existe') });
    const response = await request(missing).get('/plano');
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({ code: 'UNAVAILABLE', message: 'A interface não está disponível neste servidor.' });
    // A API continua a responder.
    await request(missing).get('/api/v1/public-info').expect(200);
  });

  it('a API e os outros métodos não recebem a página da aplicação', async () => {
    const api = await request(served).get('/api/v1/nada').expect(404);
    expect(api.body.error.code).toBe('NOT_FOUND');
    await request(served).post('/plano').expect(404);
  });
});

describe('informação pública configurada pela P4S', () => {
  it('é servida sem sessão e vem vazia quando nada foi configurado', async () => {
    const response = await request(app).get('/api/v1/public-info').expect(200);
    expect(response.body).toEqual({ contactEmail: null, legalIdentity: null, proposalTerms: [] });
  });
});
