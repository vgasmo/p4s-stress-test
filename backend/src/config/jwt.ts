import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { USER_ROLES, type AuthUser } from '../models/domain.js';
import { unauthorized } from '../utils/errors.js';
import { env } from './env.js';

const ALGORITHM = 'HS256' as const;
const ISSUER = 'p4s-stress-test';

const accessClaimsSchema = z.object({
  typ: z.literal('access'),
  userId: z.guid(),
  companyId: z.guid().nullable(),
  role: z.enum(USER_ROLES),
});

const refreshClaimsSchema = z.object({
  typ: z.literal('refresh'),
  userId: z.guid(),
  companyId: z.guid().nullable(),
  // Versão da sessão. Tokens emitidos antes de existir contam como versão 0.
  tv: z.number().int().nonnegative().default(0),
});

export type RefreshClaims = z.infer<typeof refreshClaimsSchema>;

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { typ: 'access', userId: user.userId, companyId: user.companyId, role: user.role },
    env.JWT_SECRET,
    { algorithm: ALGORITHM, issuer: ISSUER, subject: user.userId, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
  );
}

/**
 * O refresh não leva o papel: é relido da base de dados em cada renovação. Leva a versão
 * da sessão (users.token_version), que sobe quando a palavra-passe muda ou a conta é desativada.
 */
export function signRefreshToken(userId: string, companyId: string | null, tokenVersion: number): string {
  return jwt.sign({ typ: 'refresh', userId, companyId, tv: tokenVersion }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    issuer: ISSUER,
    subject: userId,
    expiresIn: env.JWT_REFRESH_TTL_SECONDS,
  });
}

function verify<T>(token: string, schema: z.ZodType<T>): T {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM], issuer: ISSUER });
  } catch {
    throw unauthorized('Sessão inválida ou expirada.');
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) throw unauthorized('Sessão inválida.');
  return parsed.data;
}

export function verifyAccessToken(token: string): AuthUser {
  const { userId, companyId, role } = verify(token, accessClaimsSchema);
  return { userId, companyId, role };
}

export function verifyRefreshToken(token: string): RefreshClaims {
  return verify(token, refreshClaimsSchema);
}
