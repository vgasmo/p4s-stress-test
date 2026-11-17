import type { Request, Response } from 'express';
import { getAuth, getTenant } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type { CreateUserInput, UpdateUserInput } from '../models/schemas.js';
import { userService } from '../services/user.service.js';

export const userController = {
  async listCompanyUsers(req: Request, res: Response): Promise<void> {
    res.json(await userService.listCompanyUsers(getTenant(req)));
  },

  async listTeam(_req: Request, res: Response): Promise<void> {
    res.json(await userService.listTeam());
  },

  async create(req: Request, res: Response): Promise<void> {
    const created = await userService.create(getAuth(req), validated<CreateUserInput>(req, 'body'));
    // A resposta leva o link de palavra-passe: não deve ficar em nenhuma cache.
    res.status(201).set('Cache-Control', 'no-store').json(created);
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await userService.update(getAuth(req), id, validated<UpdateUserInput>(req, 'body')));
  },

  async createPasswordLink(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.status(201).set('Cache-Control', 'no-store').json(await userService.createPasswordLink(getAuth(req), id));
  },
};
