import type { Request, Response } from 'express';
import { CATALOG } from '../services/catalog.private.js';

export const catalogController = {
  /** Pesos, pisos, preços e prazos, para o cálculo imediato no browser da equipa P4S. */
  get(_req: Request, res: Response): void {
    res.json(CATALOG);
  },
};
