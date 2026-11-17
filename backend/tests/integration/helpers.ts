import bcrypt from 'bcryptjs';
import request from 'supertest';
import { runMigrations } from '../../scripts/migrate.js';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/config/database.js';
import type { AuthSession } from '../../src/models/api.types.js';
import { companyModel } from '../../src/models/company.model.js';
import type { Company, User } from '../../src/models/domain.js';
import { userModel } from '../../src/models/user.model.js';
import { nifWithCheckDigit } from '../../src/utils/validation.js';

export const app = createApp();
export const PASSWORD = 'Palavra-passe-de-teste-123';

/** NIF válido a partir de 8 dígitos. */
export const nifFrom = nifWithCheckDigit;

/** Recria o schema do zero. Só corre em bases de dados cujo nome termina em «_test». */
export async function resetDatabase(): Promise<void> {
  const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const name = rows[0]?.name ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(
      `Os testes de integração apagam todos os dados. Recusado em «${name}»: use uma base de dados terminada em _test (TEST_DATABASE_URL).`,
    );
  }
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(pool);
}

export interface Fixture {
  companyA: Company;
  companyB: Company;
  admin: User;
  consultant: User;
  userA: User;
  userB: User;
  inactive: User;
}

export async function seedFixture(): Promise<Fixture> {
  await pool.query('TRUNCATE password_tokens, tasks, assessments, users, companies RESTART IDENTITY CASCADE');
  const passwordHash = await bcrypt.hash(PASSWORD, 4);

  const companyA = await companyModel.insert(pool, {
    name: 'Moldes Exemplo A, Lda',
    nif: nifFrom('50000000'),
    cae: '25734',
    sectorProfile: 'automotive_molds',
    annualRevenue: 6_500_000,
    exportPercentage: 70,
  });
  const companyB = await companyModel.insert(pool, {
    name: 'Embalagens Exemplo B, SA',
    nif: nifFrom('51000000'),
    cae: '22220',
    sectorProfile: 'agro_packaging',
    annualRevenue: 3_000_000,
    exportPercentage: 30,
  });

  const user = (email: string, role: User['role'], companyId: string | null, fullName: string) =>
    userModel.insert(pool, { email, role, companyId, fullName, passwordHash, hasPassword: true });

  const admin = await user('admin@p4s.test', 'admin', null, 'Admin P4S');
  const consultant = await user('consultora@p4s.test', 'consultant', null, 'Consultora P4S');
  const userA = await user('gestor@empresa-a.test', 'company_user', companyA.id, 'Gestor A');
  const userB = await user('gestor@empresa-b.test', 'company_user', companyB.id, 'Gestor B');
  const inactive = await user('antigo@empresa-a.test', 'company_user', companyA.id, 'Ex-colaborador A');
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [inactive.id]);

  return { companyA, companyB, admin, consultant, userA, userB, inactive };
}

export async function login(email: string, companyId?: string): Promise<AuthSession> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, ...(companyId ? { companyId } : {}) });
  if (response.status !== 200) throw new Error(`Login falhou (${response.status}): ${JSON.stringify(response.body)}`);
  return response.body as AuthSession;
}

export const bearer = (session: AuthSession) => ({ Authorization: `Bearer ${session.accessToken}` });

/** Respostas de uma fábrica de moldes sem TISAX e sem dossier bancário. */
export const AUTOMOTIVE_ANSWERS = {
  topClientsShare: 62,
  creditLineToRefinance: 3_000_000,
  ecovadis: false,
  carbonFootprintScope12: true,
  carbonFootprintScope3: false,
  bankingEsgMetrics: false,
  tisaxOrNis2: false,
};
