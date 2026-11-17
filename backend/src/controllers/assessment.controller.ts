import type { Request, Response } from 'express';
import { getAuth, getTenant } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type { CreateAssessmentInput, SimulateAssessmentInput } from '../models/schemas.js';
import { assessmentService } from '../services/assessment.service.js';

export const assessmentController = {
  /** Público: cálculo em memória, nada é gravado. */
  simulate(req: Request, res: Response): void {
    res.json(assessmentService.simulate(validated<SimulateAssessmentInput>(req, 'body')));
  },

  async create(req: Request, res: Response): Promise<void> {
    const detail = await assessmentService.create(getAuth(req), validated<CreateAssessmentInput>(req, 'body'));
    res.status(201).location(`/api/v1/assessments/${detail.id}`).json(detail);
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await assessmentService.get(getTenant(req), id));
  },

  async list(req: Request, res: Response): Promise<void> {
    res.json(await assessmentService.list(getTenant(req)));
  },
};
