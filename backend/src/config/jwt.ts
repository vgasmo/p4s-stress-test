import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { USER_ROLES, type AuthUser } from '../models/domain.js';
import { unauthorized } from '../utils/errors.js';
import { env } from './env.js';

const ALGORITHM = 'HS256' as const;
const ISSUER = 'p4s-stress-test';

// Versão da sessão (users.token_version). Tokens emitidos antes de existir contam como versão 0.
const tokenVersion = z.number().int().nonnegative().default(0);

const accessClaimsSchema = z.object({
  typ: z.literal('access'),
  userId: z.guid(),
  companyId: z.guid().nullable(),
  role: z.enum(USER_ROLES),
  tv: tokenVersion,
});

const refreshClaimsSchema = z.object({
  typ: z.literal('refresh'),
  userId: z.guid(),
  companyId: z.guid().nullable(),
  tv: tokenVersion,
  /** Início da sessão (login), em segundos. Passa de renovação em renovação. */
  sst: z.number().int().positive().optional(),
  iat: z.number().int().positive(),
});

export interface AccessClaims extends AuthUser {
  tokenVersion: number;
}

export interface RefreshClaims {
  userId: string;
  companyId: string | null;
  tokenVersion: number;
  /** Segundos desde a época em que a sessão começou. */
  sessionStartedAt: number;
}

export const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * O token de acesso leva a versão da sessão: cada pedido confirma-a na base de dados, por
 * isso terminar a sessão, mudar a palavra-passe ou desativar a conta tem efeito imediato.
 */
export function signAccessToken(user: AuthUser, version: number): string {
  return jwt.sign(
    { typ: 'access', userId: user.userId, companyId: user.companyId, role: user.role, tv: version },
    env.JWT_SECRET,
    { algorithm: ALGORITHM, issuer: ISSUER, subject: user.userId, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
  );
}

/** O refresh não leva o papel: é relido da base de dados em cada renovação. */
export function signRefreshToken(
  userId: string,
  companyId: string | null,
  version: number,
  sessionStartedAt: number,
): string {
  return jwt.sign({ typ: 'refresh', userId, companyId, tv: version, sst: sessionStartedAt }, env.JWT_SECRET, {
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

export function verifyAccessToken(token: string): AccessClaims {
  const { userId, companyId, role, tv } = verify(token, accessClaimsSchema);
  return { userId, companyId, role, tokenVersion: tv };
}

export function verifyRefreshToken(token: string): RefreshClaims {
  const { userId, companyId, tv, sst, iat } = verify(token, refreshClaimsSchema);
  return { userId, companyId, tokenVersion: tv, sessionStartedAt: sst ?? iat };
}
