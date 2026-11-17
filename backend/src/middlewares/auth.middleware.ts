import type { Request, RequestHandler } from 'express';
import { pool } from '../config/database.js';
import { verifyAccessToken } from '../config/jwt.js';
import type { AuthUser, TenantContext } from '../models/domain.js';
import { userModel } from '../models/user.model.js';
import { companyScopeRequired, unauthorized } from '../utils/errors.js';

/**
 * Valida o JWT (Authorization: Bearer) e confirma-o na base de dados antes de preencher req.user:
 * a conta tem de existir, estar ativa e ter a mesma versão de sessão do token. Assim, terminar
 * a sessão, mudar a palavra-passe ou desativar a conta corta o acesso no pedido seguinte, e um
 * token assinado para um utilizador que não existe não serve para nada.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match?.[1]) throw unauthorized();
  const claims = verifyAccessToken(match[1]);

  const user = await userModel.findById(pool, claims.userId);
  if (!user || !user.isActive || user.tokenVersion !== claims.tokenVersion) {
    throw unauthorized('Sessão terminada. Inicie sessão novamente.');
  }
  // Um utilizador de empresa nunca sai da sua. O papel que vale é o da base de dados.
  if (user.role === 'company_user' && claims.companyId !== user.companyId) {
    throw unauthorized('Sessão inválida.');
  }
  req.user = { userId: user.id, companyId: claims.companyId, role: user.role };
  next();
};

/**
 * Sessão opcional: sem cabeçalho Authorization o pedido segue como anónimo. Um token
 * presente mas inválido é recusado, para não responder como anónimo a quem julga ter sessão.
 */
export const authenticateOptional: RequestHandler = (req, res, next) => {
  if (!req.get('authorization')) {
    next();
    return;
  }
  return authenticate(req, res, next);
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
