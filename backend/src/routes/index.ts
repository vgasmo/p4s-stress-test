import { Router } from 'express';
import { env } from '../config/env.js';
import type { PublicInfo } from '../models/api.types.js';
import { assessmentRoutes } from './assessment.routes.js';
import { authRoutes } from './auth.routes.js';
import { catalogRoutes } from './catalog.routes.js';
import { companyRoutes } from './company.routes.js';
import { taskRoutes } from './task.routes.js';
import { userRoutes } from './user.routes.js';

/** /api/v1 */
export function apiRouter(): Router {
  const router = Router();
  // Contacto e condições da proposta, definidos por quem publica (ver .env.example). Sem sessão:
  // o contacto aparece na página pública e o resto no resumo impresso.
  router.get('/public-info', (_req, res) => {
    const info: PublicInfo = {
      contactEmail: env.P4S_CONTACT_EMAIL ?? null,
      legalIdentity: env.P4S_LEGAL_IDENTITY ?? null,
      proposalTerms: env.P4S_PROPOSAL_TERMS,
    };
    res.json(info);
  });
  router.use('/auth', authRoutes());
  router.use('/catalog', catalogRoutes());
  router.use('/assessments', assessmentRoutes());
  router.use('/tasks', taskRoutes());
  router.use('/companies', companyRoutes());
  router.use('/users', userRoutes());
  return router;
}
