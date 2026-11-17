import type { Request, Response } from 'express';
import { CATALOG } from '../services/catalog.private.js';

export const catalogController = {
  /** Pesos, pisos, preços e prazos, para o cálculo imediato no browser de quem tem sessão. */
  get(_req: Request, res: Response): void {
    res.set('Cache-Control', 'private, max-age=300').json(CATALOG);
  },
};
