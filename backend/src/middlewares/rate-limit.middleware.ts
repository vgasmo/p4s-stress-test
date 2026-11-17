import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import type { ApiErrorBody } from '../models/api.types.js';

const tooMany = (message: string): ApiErrorBody => ({ error: { code: 'TOO_MANY_REQUESTS', message } });
const skip = () => env.NODE_ENV === 'test';

const base = { standardHeaders: 'draft-7', legacyHeaders: false, skip } as const;

/** Tentativas de login falhadas por IP (as bem-sucedidas não contam). */
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: tooMany('Demasiadas tentativas. Aguarde 15 minutos.'),
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
