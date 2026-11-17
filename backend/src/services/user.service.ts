// Gestão de utilizadores e links de palavra-passe.
//
// Não há envio de email: a equipa P4S cria a conta e recebe um link de uso único, que
// entrega ao utilizador pelo canal que já usa com ele. O mesmo mecanismo serve para
// convidar e para recuperar a palavra-passe.
//
// Quem gere quem:
//   - admin e consultor gerem os utilizadores da empresa que têm selecionada;
//   - só o admin gere a equipa P4S (consultores e administradores);
//   - um utilizador da empresa não gere ninguém.

import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type pg from 'pg';
import { pool, withTransaction, type Queryable } from '../config/database.js';
import type {
  AuthSession,
  CreatedUser,
  ManagedUser,
  PasswordLink,
  PasswordLinkInfo,
} from '../models/api.types.js';
import { isStaffRole, type AuthUser, type TenantContext, type User } from '../models/domain.js';
import { passwordTokenModel } from '../models/password-token.model.js';
import type { ChangePasswordInput, CreateUserInput, SetPasswordInput, UpdateUserInput } from '../models/schemas.js';
import { userModel } from '../models/user.model.js';
import { AppError, badRequest, companyScopeRequired, conflict, forbidden, notFound, unauthorized } from '../utils/errors.js';
import { hashPassword, issueSession, resolveCompanyScope } from './auth.service.js';

export const INVITE_LINK_TTL_HOURS = 7 * 24;
export const RESET_LINK_TTL_HOURS = 48;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const invalidLink = () =>
  new AppError(400, 'INVALID_PASSWORD_LINK', 'Este link já não é válido. Peça um novo à equipa Plan4Sustain.');

function toManaged(user: User, pendingLinkExpiresAt: string | null): ManagedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    companyId: user.companyId,
    status: !user.isActive ? 'disabled' : user.passwordSetAt ? 'active' : 'invited',
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    pendingLinkExpiresAt,
  };
}

async function withPendingLinks(users: User[]): Promise<ManagedUser[]> {
  const pending = await passwordTokenModel.pendingExpiryByUser(
    pool,
    users.map((user) => user.id),
  );
  return users.map((user) => toManaged(user, pending.get(user.id) ?? null));
}

/** Conta alvo, se quem pede a pode gerir. Fora do alcance responde 404, sem revelar que existe. */
async function loadManageable(db: Queryable, auth: AuthUser, id: string, forUpdate = false): Promise<User> {
  const target = await userModel.findById(db, id, { forUpdate });
  const allowed =
    target !== null &&
    isStaffRole(auth.role) &&
    (isStaffRole(target.role)
      ? auth.role === 'admin'
      : auth.companyId !== null && target.companyId === auth.companyId);
  if (!target || !allowed) throw notFound('Utilizador não encontrado.');
  return target;
}

async function issuePasswordLink(client: pg.PoolClient, target: User, createdBy: string): Promise<PasswordLink> {
  // Um link novo anula os anteriores: só o último entregue funciona.
  await passwordTokenModel.deleteUnusedForUser(client, target.id);
  const token = randomBytes(32).toString('base64url');
  const purpose = target.passwordSetAt ? 'reset' : 'invite';
  const stored = await passwordTokenModel.create(client, {
    userId: target.id,
    tokenHash: hashToken(token),
    purpose,
    ttlHours: purpose === 'invite' ? INVITE_LINK_TTL_HOURS : RESET_LINK_TTL_HOURS,
    createdBy,
  });
  return { token, purpose, expiresAt: stored.expiresAt };
}

export const userService = {
  async listCompanyUsers(ctx: TenantContext): Promise<ManagedUser[]> {
    return withPendingLinks(await userModel.listByCompany(pool, ctx.companyId));
  },

  async listTeam(): Promise<ManagedUser[]> {
    return withPendingLinks(await userModel.listStaff(pool));
  },

  /** Cria a conta sem palavra-passe e devolve o link para o utilizador a definir. */
  async create(auth: AuthUser, input: CreateUserInput): Promise<CreatedUser> {
    const staffAccount = isStaffRole(input.role);
    if (staffAccount && auth.role !== 'admin') throw forbidden('Só um administrador pode criar contas da equipa P4S.');
    if (!staffAccount && !auth.companyId) throw companyScopeRequired();

    return withTransaction(async (client) => {
      if (await userModel.findByEmail(client, input.email)) {
        throw conflict('Já existe um utilizador com este email.');
      }
      const user = await userModel.insert(client, {
        companyId: staffAccount ? null : auth.companyId,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        // Hash de um valor aleatório que ninguém conhece: a conta só fica utilizável pelo link.
        passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
        hasPassword: false,
      });
      const passwordLink = await issuePasswordLink(client, user, auth.userId);
      return { user: toManaged(user, passwordLink.expiresAt), passwordLink };
    });
  },

  async update(auth: AuthUser, id: string, patch: UpdateUserInput): Promise<ManagedUser> {
    return withTransaction(async (client) => {
      const target = await loadManageable(client, auth, id, true);
      if (patch.isActive === false && target.isActive) {
        if (target.id === auth.userId) throw badRequest('Não pode desativar a sua própria conta.');
        if (target.role === 'admin' && (await userModel.countActiveAdmins(client)) <= 1) {
          throw conflict('Tem de existir pelo menos um administrador ativo.');
        }
        // Uma conta desativada não deve ter links por usar à espera.
        await passwordTokenModel.deleteUnusedForUser(client, target.id);
      }
      const updated = await userModel.update(client, id, patch);
      if (!updated) throw notFound('Utilizador não encontrado.');
      const pending = await passwordTokenModel.pendingExpiryByUser(client, [updated.id]);
      return toManaged(updated, pending.get(updated.id) ?? null);
    });
  },

  /** Novo link de uso único (convite se a conta ainda não tem palavra-passe, recuperação se tem). */
  async createPasswordLink(auth: AuthUser, id: string): Promise<PasswordLink> {
    return withTransaction(async (client) => {
      const target = await loadManageable(client, auth, id, true);
      if (!target.isActive) throw badRequest('Reative a conta antes de gerar um link.');
      return issuePasswordLink(client, target, auth.userId);
    });
  },

  /** Público: diz a quem pertence o link, para a página mostrar o nome antes de pedir a palavra-passe. */
  async inspectPasswordLink(token: string): Promise<PasswordLinkInfo> {
    const stored = await passwordTokenModel.findValidByHash(pool, hashToken(token));
    const user = stored ? await userModel.findById(pool, stored.userId) : null;
    if (!stored || !user || !user.isActive) throw invalidLink();
    return { fullName: user.fullName, email: user.email, purpose: stored.purpose, expiresAt: stored.expiresAt };
  },

  /** Público: define a palavra-passe com um link válido e abre a sessão. O link fica gasto. */
  async setPassword(input: SetPasswordInput): Promise<AuthSession> {
    const user = await withTransaction(async (client) => {
      const stored = await passwordTokenModel.findValidByHash(client, hashToken(input.token), { forUpdate: true });
      const target = stored ? await userModel.findById(client, stored.userId, { forUpdate: true }) : null;
      if (!stored || !target || !target.isActive) throw invalidLink();
      if (input.password.toLowerCase() === target.email.toLowerCase()) {
        throw badRequest('A palavra-passe não pode ser o email.');
      }
      await passwordTokenModel.markUsed(client, stored.id);
      await passwordTokenModel.deleteUnusedForUser(client, target.id);
      const updated = await userModel.setPassword(client, target.id, await hashPassword(input.password));
      if (!updated) throw invalidLink();
      await userModel.touchLogin(client, updated.id);
      return updated;
    });
    return issueSession(user, await resolveCompanyScope(user, undefined));
  },

  /** Com sessão: troca a palavra-passe e devolve uma sessão nova (as anteriores deixam de renovar). */
  async changePassword(auth: AuthUser, input: ChangePasswordInput): Promise<AuthSession> {
    const user = await userModel.findById(pool, auth.userId);
    if (!user || !user.isActive) throw unauthorized('Sessão inválida.');
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw badRequest('A palavra-passe atual não está correta.');
    }
    if (input.newPassword.toLowerCase() === user.email.toLowerCase()) {
      throw badRequest('A palavra-passe não pode ser o email.');
    }
    const updated = await userModel.setPassword(pool, user.id, await hashPassword(input.newPassword));
    if (!updated) throw unauthorized('Sessão inválida.');
    // Mantém a empresa em que a pessoa estava a trabalhar.
    return issueSession(updated, await resolveCompanyScope(updated, auth.companyId ?? undefined));
  },
};
