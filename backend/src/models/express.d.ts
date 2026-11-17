import type { AuthUser } from './domain.js';

declare global {
  namespace Express {
    interface Request {
      /** Preenchido por authenticate a partir do JWT validado. */
      user?: AuthUser;
      /** Preenchido por validate com os dados já validados pelo zod. */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
