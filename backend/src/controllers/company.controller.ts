import type { Request, Response } from 'express';
import { getAuth, getTenant } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type { CreateCompanyInput, UpdateCompanyInput } from '../models/schemas.js';
import { companyService } from '../services/company.service.js';

export const companyController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.json(await companyService.list());
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await companyService.get(getAuth(req), id));
  },

  async create(req: Request, res: Response): Promise<void> {
    const company = await companyService.create(validated<CreateCompanyInput>(req, 'body'));
    res.status(201).location(`/api/v1/companies/${company.id}`).json(company);
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await companyService.update(id, validated<UpdateCompanyInput>(req, 'body')));
  },

  async listAssignableUsers(req: Request, res: Response): Promise<void> {
    res.json(await companyService.listAssignableUsers(getTenant(req)));
  },
};
