import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import type { ApiErrorBody } from '../models/api.types.js';

const tooMany = (message: string): ApiErrorBody => ({ error: { code: 'TOO_MANY_REQUESTS', message } });
// Desligados nos testes, exceto no teste que os exercita de propósito.
const skip = () => env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== 'on';

const base = { standardHeaders: 'draft-7', legacyHeaders: false, skip } as const;

const emailOf = (req: Request): string => {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 255) : '';
};

/**
 * Tentativas de login falhadas por endereço e por email (as bem-sucedidas não contam).
 * A chave leva o email para que as tentativas erradas contra uma conta não bloqueiem o
 * login das outras pessoas que partilham o mesmo endereço (um escritório, um proxy).
 */
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip ?? ''}|${emailOf(req)}`,
  message: tooMany('Demasiadas tentativas. Aguarde 15 minutos.'),
});

/** Teto de tentativas falhadas por endereço, seja qual for o email. */
export const loginAddressLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 100,
  skipSuccessfulRequests: true,
  message: tooMany('Demasiadas tentativas a partir deste endereço. Aguarde 15 minutos.'),
});

/** Renovação de sessão e troca de empresa: uso normal numa reunião, com margem. */
export const refreshLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 120,
  message: tooMany('Demasiados pedidos de sessão. Aguarde uns minutos.'),
});

/** Links de palavra-passe: são públicos e o token é o segredo, por isso o limite é apertado. */
export const passwordLinkLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 20,
  message: tooMany('Demasiadas tentativas. Aguarde 15 minutos.'),
});

/** A simulação é pública: limite generoso para reuniões, mas não ilimitado. */
export const simulateLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 120,
  message: tooMany('Demasiadas simulações seguidas. Aguarde um minuto.'),
});

/**
 * Carregamento de documentos para análise com IA: cada um custa uma chamada a um serviço pago.
 * Conta por utilizador (a rota já tem sessão), para um consultor não gastar a quota dos outros.
 */
export const documentUploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 30,
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? '',
  message: tooMany('Demasiados documentos carregados na última hora. Aguarde e tente de novo.'),
});
