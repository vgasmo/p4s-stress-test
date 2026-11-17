import type { Request, RequestHandler } from 'express';
import { verifyAccessToken } from '../config/jwt.js';
import type { AuthUser, TenantContext } from '../models/domain.js';
import { companyScopeRequired, unauthorized } from '../utils/errors.js';

/** Valida o JWT (Authorization: Bearer) e preenche req.user. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match?.[1]) throw unauthorized();
  req.user = verifyAccessToken(match[1]);
  next();
};

/** Exige empresa selecionada no token (tudo o que toca em assessments e tasks). */
export const requireCompanyScope: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (!req.user.companyId) throw companyScopeRequired();
  next();
};

export function getAuth(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Contexto multi-tenant. O companyId vem exclusivamente do JWT validado. */
export function getTenant(req: Request): TenantContext {
  const { userId, companyId, role } = getAuth(req);
  if (!companyId) throw companyScopeRequired();
  return { userId, companyId, role };
}
