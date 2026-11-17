import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../config/jwt.js';
import type { AuthSession, MeResponse } from '../models/api.types.js';
import { companyModel } from '../models/company.model.js';
import type { AuthUser, User } from '../models/domain.js';
import type { LoginInput, RefreshInput } from '../models/schemas.js';
import { toPublicUser, userModel } from '../models/user.model.js';
import { forbidden, notFound, unauthorized } from '../utils/errors.js';

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

// Compara sempre com um hash, mesmo sem utilizador, para não revelar emails pelo tempo de resposta.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('p4s-timing-equalizer', env.BCRYPT_ROUNDS));

/**
 * company_user fica sempre na sua empresa. A equipa P4S escolhe a empresa
 * (undefined mantém a atual, null limpa).
 */
async function resolveCompanyScope(user: User, requested: string | null | undefined): Promise<string | null> {
  if (user.role === 'company_user') {
    if (requested && requested !== user.companyId) throw forbidden('Sem acesso a esta empresa.');
    return user.companyId;
  }
  if (requested === undefined) return user.companyId;
  if (requested === null) return null;
  const company = await companyModel.findById(pool, requested);
  if (!company) throw notFound('Empresa não encontrada.');
  return company.id;
}

function issueSession(user: User, companyId: string | null): AuthSession {
  return {
    accessToken: signAccessToken({ userId: user.id, companyId, role: user.role }),
    refreshToken: signRefreshToken(user.id, companyId),
    tokenType: 'Bearer',
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    user: toPublicUser(user),
    companyId,
  };
}

export const authService = {
  async login(input: LoginInput): Promise<AuthSession> {
    const user = await userModel.findByEmail(pool, input.email);
    const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !passwordOk || !user.isActive) throw unauthorized('Email ou palavra-passe incorretos.');
    return issueSession(user, await resolveCompanyScope(user, input.companyId));
  },

  /** Renova a sessão (rotação do refresh) e, para a equipa P4S, permite mudar de empresa. */
  async refresh(input: RefreshInput): Promise<AuthSession> {
    const claims = verifyRefreshToken(input.refreshToken);
    const user = await userModel.findById(pool, claims.userId);
    if (!user || !user.isActive) throw unauthorized('Sessão inválida.');
    const requested = input.companyId !== undefined ? input.companyId : claims.companyId;
    return issueSession(user, await resolveCompanyScope(user, requested));
  },

  async me(auth: AuthUser): Promise<MeResponse> {
    const user = await userModel.findById(pool, auth.userId);
    if (!user || !user.isActive) throw unauthorized('Sessão inválida.');
    const company = auth.companyId ? await companyModel.findById(pool, auth.companyId) : null;
    return { user: toPublicUser(user), companyId: auth.companyId, company };
  },
};
