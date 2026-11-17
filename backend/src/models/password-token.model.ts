// Links de palavra-passe de uso único. Só se guarda o SHA-256 do token: quem ler a base
// de dados não consegue reconstruir um link válido.

import type { Queryable } from '../config/database.js';
import type { PasswordLinkPurpose } from './api.types.js';

export interface PasswordToken {
  id: string;
  userId: string;
  purpose: PasswordLinkPurpose;
  expiresAt: string;
}

interface PasswordTokenRow {
  id: string;
  user_id: string;
  purpose: PasswordLinkPurpose;
  expires_at: Date;
}

const toToken = (row: PasswordTokenRow): PasswordToken => ({
  id: row.id,
  userId: row.user_id,
  purpose: row.purpose,
  expiresAt: row.expires_at.toISOString(),
});

export const passwordTokenModel = {
  async create(
    db: Queryable,
    token: { userId: string; tokenHash: string; purpose: PasswordLinkPurpose; ttlHours: number; createdBy: string },
  ): Promise<PasswordToken> {
    const { rows } = await db.query<PasswordTokenRow>(
      `INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at, created_by)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP + make_interval(hours => $4), $5)
       RETURNING id, user_id, purpose, expires_at`,
      [token.userId, token.tokenHash, token.purpose, token.ttlHours, token.createdBy],
    );
    return toToken(rows[0] as PasswordTokenRow);
  },

  /** Token por usar e dentro do prazo. Com forUpdate fica bloqueado até ao fim da transação. */
  async findValidByHash(db: Queryable, tokenHash: string, options: { forUpdate?: boolean } = {}): Promise<PasswordToken | null> {
    const { rows } = await db.query<PasswordTokenRow>(
      `SELECT id, user_id, purpose, expires_at FROM password_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP${options.forUpdate ? ' FOR UPDATE' : ''}`,
      [tokenHash],
    );
    return rows[0] ? toToken(rows[0]) : null;
  },

  async markUsed(db: Queryable, id: string): Promise<void> {
    await db.query(`UPDATE password_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
  },

  /** Anula os links por usar de um utilizador (ao gerar um novo ou ao definir a palavra-passe). */
  async deleteUnusedForUser(db: Queryable, userId: string): Promise<void> {
    await db.query(`DELETE FROM password_tokens WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  },

  /** Validade do link por usar de cada utilizador, para a lista de gestão. */
  async pendingExpiryByUser(db: Queryable, userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const { rows } = await db.query<{ user_id: string; expires_at: Date }>(
      `SELECT user_id, max(expires_at) AS expires_at FROM password_tokens
       WHERE user_id = ANY($1::uuid[]) AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       GROUP BY user_id`,
      [userIds],
    );
    return new Map(rows.map((row) => [row.user_id, row.expires_at.toISOString()]));
  },
};
