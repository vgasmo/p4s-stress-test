import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { nowInSeconds, signAccessToken, signRefreshToken, verifyRefreshToken } from '../config/jwt.js';
import type { AuthSession, MeResponse } from '../models/api.types.js';
import { companyModel } from '../models/company.model.js';
import type { AuthUser, User } from '../models/domain.js';
import { passwordTokenModel } from '../models/password-token.model.js';
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
export async function resolveCompanyScope(user: User, requested: string | null | undefined): Promise<string | null> {
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

/** sessionStartedAt: momento do login. Mantém-se nas renovações, para a sessão ter um fim. */
export function issueSession(
  user: User,
  companyId: string | null,
  sessionStartedAt: number = nowInSeconds(),
): AuthSession {
  return {
    accessToken: signAccessToken({ userId: user.id, companyId, role: user.role }, user.tokenVersion),
    refreshToken: signRefreshToken(user.id, companyId, user.tokenVersion, sessionStartedAt),
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
    const session = issueSession(user, await resolveCompanyScope(user, input.companyId));
    await userModel.touchLogin(pool, user.id);
    return session;
  },

  /** Renova a sessão e, para a equipa P4S, permite mudar de empresa. */
  async refresh(input: RefreshInput): Promise<AuthSession> {
    const claims = verifyRefreshToken(input.refreshToken);
    // Uma sessão não se renova para sempre: ao fim do prazo máximo é preciso entrar outra vez.
    if (nowInSeconds() - claims.sessionStartedAt > env.SESSION_MAX_TTL_SECONDS) {
      throw unauthorized('Sessão expirada. Inicie sessão novamente.');
    }
    const user = await userModel.findById(pool, claims.userId);
    // A versão muda quando a sessão é terminada, a palavra-passe muda ou a conta é desativada.
    if (!user || !user.isActive || claims.tokenVersion !== user.tokenVersion) throw unauthorized('Sessão inválida.');
    const requested = input.companyId !== undefined ? input.companyId : claims.companyId;
    return issueSession(user, await resolveCompanyScope(user, requested), claims.sessionStartedAt);
  },

  /**
   * Termina a sessão em todos os dispositivos: os tokens emitidos até agora deixam de valer,
   * e os links de palavra-passe por usar também. Quem sai identifica-se com o refresh token,
   * que vale enquanto a sessão existir. O token de acesso expira ao fim de minutos: exigi-lo
   * deixava «Sair» sem efeito no servidor depois de um intervalo sem pedidos.
   */
  async logout(refreshToken: string): Promise<void> {
    const claims = verifyRefreshToken(refreshToken);
    await withTransaction(async (client) => {
      const user = await userModel.findById(client, claims.userId, { forUpdate: true });
      if (!user || claims.tokenVersion !== user.tokenVersion) throw unauthorized('Sessão inválida ou expirada.');
      await userModel.revokeSessions(client, user.id);
      await passwordTokenModel.deleteUnusedForUser(client, user.id);
    });
  },

  async me(auth: AuthUser): Promise<MeResponse> {
    const user = await userModel.findById(pool, auth.userId);
    if (!user || !user.isActive) throw unauthorized('Sessão inválida.');
    const company = auth.companyId ? await companyModel.findById(pool, auth.companyId) : null;
    return { user: toPublicUser(user), companyId: auth.companyId, company };
  },
};
