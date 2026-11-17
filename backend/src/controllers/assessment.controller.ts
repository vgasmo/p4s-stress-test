import type { Request, Response } from 'express';
import { getAuth, getTenant } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import { isStaffRole } from '../models/domain.js';
import type { CreateAssessmentInput, SimulateAssessmentInput } from '../models/schemas.js';
import { assessmentService } from '../services/assessment.service.js';

export const assessmentController = {
  /** Cálculo em memória, nada é gravado. Só a equipa P4S recebe os valores exatos. */
  simulate(req: Request, res: Response): void {
    const fullAccess = req.user !== undefined && isStaffRole(req.user.role);
    res.json(assessmentService.simulate(validated<SimulateAssessmentInput>(req, 'body'), fullAccess));
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

  async reissueProposal(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await assessmentService.reissueProposal(getTenant(req), id));
  },

  async remove(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    await assessmentService.remove(getTenant(req), id);
    res.status(204).end();
  },
};
