import type { Queryable } from '../config/database.js';
import type { PublicUser, User, UserRole } from './domain.js';

const COLUMNS = `id, company_id, email, password_hash, full_name, role, is_active, token_version,
  password_set_at, last_login_at, created_at`;

interface UserRow {
  id: string;
  company_id: string | null;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  token_version: number;
  password_set_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  companyId: row.company_id,
  email: row.email,
  passwordHash: row.password_hash,
  fullName: row.full_name,
  role: row.role,
  isActive: row.is_active,
  tokenVersion: row.token_version,
  passwordSetAt: row.password_set_at ? row.password_set_at.toISOString() : null,
  lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
});

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, tokenVersion: _tokenVersion, ...rest } = user;
  return rest;
}

export interface NewUser {
  companyId: string | null;
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  /** false: conta por convite, com um hash que nenhuma palavra-passe satisfaz. */
  hasPassword: boolean;
}

export const userModel = {
  async findByEmail(db: Queryable, email: string): Promise<User | null> {
    const { rows } = await db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE lower(email) = lower($1)`, [
      email,
    ]);
    return rows[0] ? toUser(rows[0]) : null;
  },

  async findById(db: Queryable, id: string, options: { forUpdate?: boolean } = {}): Promise<User | null> {
    const { rows } = await db.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  },

  /** Quem pode ser responsável por tarefas da empresa: utilizadores dela e equipa P4S ativa. */
  async listAssignable(db: Queryable, companyId: string): Promise<User[]> {
    const { rows } = await db.query<UserRow>(
      `SELECT ${COLUMNS} FROM users
       WHERE is_active AND (company_id = $1 OR role IN ('admin', 'consultant'))
       ORDER BY role DESC, full_name`,
      [companyId],
    );
    return rows.map(toUser);
  },

  /** Contas da empresa (ativas ou não), para a gestão de utilizadores. */
  async listByCompany(db: Queryable, companyId: string): Promise<User[]> {
    const { rows } = await db.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE company_id = $1 AND role = 'company_user' ORDER BY full_name, email`,
      [companyId],
    );
    return rows.map(toUser);
  },

  /** Equipa P4S. */
  async listStaff(db: Queryable): Promise<User[]> {
    const { rows } = await db.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE role IN ('admin', 'consultant') ORDER BY role, full_name, email`,
    );
    return rows.map(toUser);
  },

  /** Administradores que conseguem mesmo entrar: ativos e com palavra-passe definida. */
  async countActiveAdmins(db: Queryable): Promise<number> {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM users WHERE role = 'admin' AND is_active AND password_set_at IS NOT NULL`,
    );
    return Number(rows[0]?.n ?? 0);
  },

  async insert(db: Queryable, user: NewUser): Promise<User> {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (company_id, email, password_hash, full_name, role, password_set_at)
       VALUES ($1, lower($2), $3, $4, $5, CASE WHEN $6 THEN CURRENT_TIMESTAMP END)
       RETURNING ${COLUMNS}`,
      [user.companyId, user.email, user.passwordHash, user.fullName, user.role, user.hasPassword],
    );
    return toUser(rows[0] as UserRow);
  },

  /** Desativar invalida as sessões em curso (sobe token_version). */
  async update(db: Queryable, id: string, patch: { fullName?: string; isActive?: boolean }): Promise<User | null> {
    const { rows } = await db.query<UserRow>(
      `UPDATE users
       SET full_name = COALESCE($2, full_name),
           is_active = COALESCE($3, is_active),
           token_version = token_version + CASE WHEN $3 IS FALSE AND is_active THEN 1 ELSE 0 END
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, patch.fullName ?? null, patch.isActive ?? null],
    );
    return rows[0] ? toUser(rows[0]) : null;
  },

  /** Nova palavra-passe: as sessões anteriores deixam de poder ser renovadas. */
  async setPassword(db: Queryable, id: string, passwordHash: string): Promise<User | null> {
    const { rows } = await db.query<UserRow>(
      `UPDATE users
       SET password_hash = $2, password_set_at = CURRENT_TIMESTAMP, token_version = token_version + 1
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, passwordHash],
    );
    return rows[0] ? toUser(rows[0]) : null;
  },

  async touchLogin(db: Queryable, id: string): Promise<void> {
    await db.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
  },

  /** Termina todas as sessões do utilizador: os tokens emitidos até agora deixam de valer. */
  async revokeSessions(db: Queryable, id: string): Promise<void> {
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [id]);
  },
};
