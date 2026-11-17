import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/config/database.js';
import type { AuthSession, CreatedUser, ManagedUser, PasswordLink } from '../../src/models/api.types.js';
import { PASSWORD, app, bearer, login, resetDatabase, seedFixture, type Fixture } from './helpers.js';

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

const NEW_PASSWORD = 'Outra-palavra-passe-456';

const tryLogin = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password });
const setPassword = (token: string, password: string) =>
  request(app).post('/api/v1/auth/set-password').send({ token, password });
const inspect = (token: string) => request(app).post('/api/v1/auth/password-link/inspect').send({ token });
const refresh = (session: AuthSession) =>
  request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });

async function invite(session: AuthSession, body: Record<string, unknown>): Promise<CreatedUser> {
  const response = await request(app).post('/api/v1/users').set(bearer(session)).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as CreatedUser;
}

async function newLink(session: AuthSession, userId: string): Promise<PasswordLink> {
  const response = await request(app).post(`/api/v1/users/${userId}/password-link`).set(bearer(session));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as PasswordLink;
}

describe('convite de utilizadores', () => {
  it('cria a conta sem palavra-passe na empresa selecionada e devolve o link uma só vez', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    const response = await request(app)
      .post('/api/v1/users')
      .set(bearer(consultant))
      .send({ email: '  Nova.Pessoa@Empresa-A.test ', fullName: 'Nova Pessoa' });

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { user, passwordLink } = response.body as CreatedUser;
    expect(user).toMatchObject({
      email: 'nova.pessoa@empresa-a.test',
      fullName: 'Nova Pessoa',
      role: 'company_user',
      companyId: fx.companyA.id,
      status: 'invited',
      lastLoginAt: null,
    });
    expect(passwordLink.purpose).toBe('invite');
    expect(passwordLink.token.length).toBeGreaterThanOrEqual(40);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|password_hash|tokenHash|token_hash|tokenVersion/);

    // Na base de dados fica só o SHA-256 do token.
    const stored = await pool.query<{ token_hash: string }>('SELECT token_hash FROM password_tokens');
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.token_hash).not.toContain(passwordLink.token);

    // Sem palavra-passe definida ninguém entra nesta conta.
    expect((await tryLogin(user.email, passwordLink.token)).status).toBe(401);
    expect((await tryLogin(user.email, '')).status).toBe(400);

    const list = await request(app).get('/api/v1/users').set(bearer(consultant)).expect(200);
    const listed = (list.body as ManagedUser[]).find((u) => u.id === user.id);
    expect(listed?.pendingLinkExpiresAt).toBe(passwordLink.expiresAt);
    expect(JSON.stringify(list.body)).not.toContain(passwordLink.token);
  });

  it('o link diz a quem pertence, define a palavra-passe e só funciona uma vez', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    const { user, passwordLink } = await invite(consultant, { email: 'nova@empresa-a.test', fullName: 'Nova Pessoa' });

    const info = await inspect(passwordLink.token);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({
      fullName: 'Nova Pessoa',
      email: 'nova@empresa-a.test',
      purpose: 'invite',
      expiresAt: passwordLink.expiresAt,
    });

    // Uma palavra-passe fraca é recusada e não gasta o link.
    expect((await setPassword(passwordLink.token, 'curta')).status).toBe(400);
    expect((await setPassword(passwordLink.token, 'nova@empresa-a.test')).status).toBe(400);
    expect((await inspect(passwordLink.token)).status).toBe(200);

    const done = await setPassword(passwordLink.token, NEW_PASSWORD);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ tokenType: 'Bearer', companyId: fx.companyA.id });
    expect(done.body.user).toMatchObject({ id: user.id, role: 'company_user' });
    expect(done.body.user).not.toHaveProperty('passwordHash');

    // A sessão devolvida funciona e fica só na empresa do utilizador.
    await request(app).get('/api/v1/assessments').set(bearer(done.body)).expect(200);

    // Segunda utilização do mesmo link.
    const again = await setPassword(passwordLink.token, 'Mais-uma-palavra-passe-789');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_PASSWORD_LINK');
    expect((await inspect(passwordLink.token)).status).toBe(400);

    expect((await tryLogin('nova@empresa-a.test', NEW_PASSWORD)).status).toBe(200);
    const list = await request(app).get('/api/v1/users').set(bearer(consultant)).expect(200);
    expect((list.body as ManagedUser[]).find((u) => u.id === user.id)).toMatchObject({
      status: 'active',
      pendingLinkExpiresAt: null,
    });
  });

  it('recusa links expirados, adulterados ou de contas desativadas', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    const { user, passwordLink } = await invite(consultant, { email: 'nova@empresa-a.test', fullName: 'Nova Pessoa' });

    expect((await setPassword(`${passwordLink.token.slice(0, -1)}x`, NEW_PASSWORD)).status).toBe(400);
    expect((await inspect('um-token-qualquer-que-nao-existe-na-base-de-dados')).status).toBe(400);

    await pool.query(`UPDATE password_tokens SET expires_at = CURRENT_TIMESTAMP - interval '1 minute'`);
    const expired = await setPassword(passwordLink.token, NEW_PASSWORD);
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('INVALID_PASSWORD_LINK');

    const fresh = await newLink(consultant, user.id);
    await request(app).put(`/api/v1/users/${user.id}`).set(bearer(consultant)).send({ isActive: false }).expect(200);
    expect((await setPassword(fresh.token, NEW_PASSWORD)).status).toBe(400);
  });

  it('email repetido é recusado, com maiúsculas ou sem elas', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    const response = await request(app)
      .post('/api/v1/users')
      .set(bearer(consultant))
      .send({ email: 'GESTOR@Empresa-A.test', fullName: 'Duplicado' });
    expect(response.status).toBe(409);
  });
});

describe('recuperação e alteração de palavra-passe', () => {
  it('um link novo anula o anterior e a nova palavra-passe invalida as sessões antigas', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    const oldSession = await login('gestor@empresa-a.test');

    const first = await newLink(consultant, fx.userA.id);
    expect(first.purpose).toBe('reset');
    const second = await newLink(consultant, fx.userA.id);
    expect((await setPassword(first.token, NEW_PASSWORD)).status).toBe(400);

    expect((await setPassword(second.token, NEW_PASSWORD)).status).toBe(200);
    expect((await tryLogin('gestor@empresa-a.test', PASSWORD)).status).toBe(401);
    expect((await tryLogin('gestor@empresa-a.test', NEW_PASSWORD)).status).toBe(200);
    // A sessão aberta antes da mudança já não se renova.
    expect((await refresh(oldSession)).status).toBe(401);
  });

  it('o utilizador troca a própria palavra-passe e fica com uma sessão nova na mesma empresa', async () => {
    const session = await login('consultora@p4s.test', fx.companyA.id);
    const change = (body: Record<string, unknown>) =>
      request(app).post('/api/v1/auth/change-password').set(bearer(session)).send(body);

    expect((await change({ currentPassword: 'errada', newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await change({ currentPassword: PASSWORD, newPassword: 'curta' })).status).toBe(400);
    expect((await change({ currentPassword: PASSWORD, newPassword: 'consultora@p4s.test' })).status).toBe(400);

    const done = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect(done.body.companyId).toBe(fx.companyA.id);

    expect((await refresh(session)).status).toBe(401);
    expect((await refresh(done.body)).status).toBe(200);
    expect((await tryLogin('consultora@p4s.test', PASSWORD)).status).toBe(401);
    expect((await tryLogin('consultora@p4s.test', NEW_PASSWORD)).status).toBe(200);
  });

  it('trocar a palavra-passe exige sessão', async () => {
    const response = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(401);
  });

  it('palavras-passe com mais de 72 bytes são recusadas em vez de cortadas', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    const link = await newLink(consultant, fx.userA.id);
    expect((await setPassword(link.token, 'á'.repeat(40))).status).toBe(400);
    expect((await setPassword(link.token, 'a'.repeat(72))).status).toBe(200);
  });
});

describe('desativar e reativar', () => {
  it('uma conta desativada não entra, não renova a sessão e não recebe links', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    const session = await login('gestor@empresa-a.test');
    const pending = await newLink(consultant, fx.userA.id);

    const off = await request(app).put(`/api/v1/users/${fx.userA.id}`).set(bearer(consultant)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ status: 'disabled', pendingLinkExpiresAt: null });

    expect((await tryLogin('gestor@empresa-a.test', PASSWORD)).status).toBe(401);
    expect((await refresh(session)).status).toBe(401);
    expect((await setPassword(pending.token, NEW_PASSWORD)).status).toBe(400);
    await request(app).post(`/api/v1/users/${fx.userA.id}/password-link`).set(bearer(consultant)).expect(400);

    const on = await request(app).put(`/api/v1/users/${fx.userA.id}`).set(bearer(consultant)).send({ isActive: true });
    expect(on.body.status).toBe('active');
    expect((await tryLogin('gestor@empresa-a.test', PASSWORD)).status).toBe(200);
    // A sessão de antes da desativação continua inválida.
    expect((await refresh(session)).status).toBe(401);
  });

  it('ninguém desativa a própria conta', async () => {
    const admin = await login('admin@p4s.test');
    const response = await request(app).put(`/api/v1/users/${fx.admin.id}`).set(bearer(admin)).send({ isActive: false });
    expect(response.status).toBe(400);
  });

  it('fica sempre pelo menos um administrador que consegue entrar', async () => {
    const admin1 = await login('admin@p4s.test');
    const { user: second, passwordLink } = await invite(admin1, {
      email: 'admin2@p4s.test',
      fullName: 'Segundo Admin',
      role: 'admin',
    });

    // Um administrador convidado que ainda não definiu palavra-passe não conta.
    const admin2Pending = await setPassword(passwordLink.token, NEW_PASSWORD);
    const admin2 = admin2Pending.body as AuthSession;
    await request(app).put(`/api/v1/users/${fx.admin.id}`).set(bearer(admin2)).send({ isActive: false }).expect(200);

    // O primeiro ainda tem um access token válido, mas já não pode deixar a equipa sem administrador.
    const response = await request(app).put(`/api/v1/users/${second.id}`).set(bearer(admin1)).send({ isActive: false });
    expect(response.status).toBe(409);
  });
});

describe('quem pode gerir quem', () => {
  it('um utilizador da empresa não gere utilizadores', async () => {
    const session = await login('gestor@empresa-a.test');
    await request(app).get('/api/v1/users').set(bearer(session)).expect(403);
    await request(app).get('/api/v1/users/team').set(bearer(session)).expect(403);
    await request(app).post('/api/v1/users').set(bearer(session)).send({ email: 'x@empresa-a.test', fullName: 'X Y' }).expect(403);
    await request(app).put(`/api/v1/users/${fx.userA.id}`).set(bearer(session)).send({ fullName: 'Outro Nome' }).expect(403);
    await request(app).post(`/api/v1/users/${fx.userA.id}/password-link`).set(bearer(session)).expect(403);
  });

  it('sem sessão não há gestão de utilizadores', async () => {
    await request(app).get('/api/v1/users').expect(401);
    await request(app).post('/api/v1/users').send({ email: 'x@empresa-a.test', fullName: 'X Y' }).expect(401);
  });

  it('a equipa P4S só gere os utilizadores da empresa que tem selecionada', async () => {
    const noScope = await login('consultora@p4s.test');
    await request(app).get('/api/v1/users').set(bearer(noScope)).expect(400);
    const created = await request(app).post('/api/v1/users').set(bearer(noScope)).send({ email: 'x@empresa-a.test', fullName: 'X Y' });
    expect(created.body.error.code).toBe('COMPANY_SCOPE_REQUIRED');

    const scopedB = await login('consultora@p4s.test', fx.companyB.id);
    const list = await request(app).get('/api/v1/users').set(bearer(scopedB)).expect(200);
    expect((list.body as ManagedUser[]).map((u) => u.email)).toEqual(['gestor@empresa-b.test']);
    await request(app).put(`/api/v1/users/${fx.userA.id}`).set(bearer(scopedB)).send({ isActive: false }).expect(404);
    await request(app).post(`/api/v1/users/${fx.userA.id}/password-link`).set(bearer(scopedB)).expect(404);

    const unchanged = await pool.query('SELECT is_active FROM users WHERE id = $1', [fx.userA.id]);
    expect(unchanged.rows[0]?.is_active).toBe(true);
  });

  it('só um administrador gere a equipa P4S', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    await request(app).get('/api/v1/users/team').set(bearer(consultant)).expect(403);
    await request(app)
      .post('/api/v1/users')
      .set(bearer(consultant))
      .send({ email: 'novo@p4s.test', fullName: 'Novo Consultor', role: 'consultant' })
      .expect(403);
    await request(app).put(`/api/v1/users/${fx.admin.id}`).set(bearer(consultant)).send({ isActive: false }).expect(404);
    await request(app).post(`/api/v1/users/${fx.admin.id}/password-link`).set(bearer(consultant)).expect(404);

    const admin = await login('admin@p4s.test');
    const { user } = await invite(admin, { email: 'novo@p4s.test', fullName: 'Novo Consultor', role: 'consultant' });
    expect(user).toMatchObject({ role: 'consultant', companyId: null, status: 'invited' });
    const team = await request(app).get('/api/v1/users/team').set(bearer(admin)).expect(200);
    expect((team.body as ManagedUser[]).map((u) => u.email).sort()).toEqual([
      'admin@p4s.test',
      'consultora@p4s.test',
      'novo@p4s.test',
    ]);
  });

  it('não aceita campos a mais (empresa, palavra-passe, estado)', async () => {
    const consultant = await login('consultora@p4s.test', fx.companyA.id);
    for (const extra of [{ companyId: fx.companyB.id }, { password: NEW_PASSWORD }, { isActive: false }]) {
      await request(app)
        .post('/api/v1/users')
        .set(bearer(consultant))
        .send({ email: 'x@empresa-a.test', fullName: 'X Y', ...extra })
        .expect(400);
    }
    await request(app).put(`/api/v1/users/${fx.userA.id}`).set(bearer(consultant)).send({ role: 'admin' }).expect(400);
    await request(app).put(`/api/v1/users/${fx.userA.id}`).set(bearer(consultant)).send({}).expect(400);
  });

  it('o administrador com uma empresa selecionada gere os utilizadores dela', async () => {
    const admin = await login('admin@p4s.test', fx.companyA.id);
    const renamed = await request(app).put(`/api/v1/users/${fx.userA.id}`).set(bearer(admin)).send({ fullName: 'Gestor Renomeado' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ fullName: 'Gestor Renomeado', status: 'active' });
  });
});
