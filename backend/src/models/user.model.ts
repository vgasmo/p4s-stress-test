import type { Queryable } from '../config/database.js';
import type { PublicUser, User, UserRole } from './domain.js';

const COLUMNS = 'id, company_id, email, password_hash, full_name, role, is_active, created_at';

interface UserRow {
  id: string;
  company_id: string | null;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
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
  createdAt: row.created_at.toISOString(),
});

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export interface NewUser {
  companyId: string | null;
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
}

export const userModel = {
  async findByEmail(db: Queryable, email: string): Promise<User | null> {
    const { rows } = await db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE lower(email) = lower($1)`, [
      email,
    ]);
    return rows[0] ? toUser(rows[0]) : null;
  },

  async findById(db: Queryable, id: string): Promise<User | null> {
    const { rows } = await db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
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

  async insert(db: Queryable, user: NewUser): Promise<User> {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (company_id, email, password_hash, full_name, role)
       VALUES ($1, lower($2), $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [user.companyId, user.email, user.passwordHash, user.fullName, user.role],
    );
    return toUser(rows[0] as UserRow);
  },
};
