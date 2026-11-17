import type { Request, Response } from 'express';
import { getAuth } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type {
  ChangePasswordInput,
  InspectPasswordLinkInput,
  LoginInput,
  RefreshInput,
  SetPasswordInput,
} from '../models/schemas.js';
import { authService } from '../services/auth.service.js';
import { userService } from '../services/user.service.js';

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

  async inspectPasswordLink(req: Request, res: Response): Promise<void> {
    const { token } = validated<InspectPasswordLinkInput>(req, 'body');
    res.set('Cache-Control', 'no-store').json(await userService.inspectPasswordLink(token));
  },

  async setPassword(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store').json(await userService.setPassword(validated<SetPasswordInput>(req, 'body')));
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    const session = await userService.changePassword(getAuth(req), validated<ChangePasswordInput>(req, 'body'));
    res.set('Cache-Control', 'no-store').json(session);
  },
};
