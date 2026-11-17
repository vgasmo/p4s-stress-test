import type { Request, Response } from 'express';
import { getAuth } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type { LoginInput, RefreshInput } from '../models/schemas.js';
import { authService } from '../services/auth.service.js';

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    res.json(await authService.login(validated<LoginInput>(req, 'body')));
  },

  async refresh(req: Request, res: Response): Promise<void> {
    res.json(await authService.refresh(validated<RefreshInput>(req, 'body')));
  },

  async me(req: Request, res: Response): Promise<void> {
    res.json(await authService.me(getAuth(req)));
  },
};
