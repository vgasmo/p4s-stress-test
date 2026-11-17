import { Router } from 'express';
import { assessmentController } from '../controllers/assessment.controller.js';
import { authenticate, requireCompanyScope } from '../middlewares/auth.middleware.js';
import { simulateLimiter } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createAssessmentSchema, idParamsSchema, simulateAssessmentSchema } from '../models/schemas.js';

export function assessmentRoutes(): Router {
  const router = Router();

  // Público (modo reunião ao vivo): sem JWT, nada é gravado.
  router.post('/simulate', simulateLimiter, validate({ body: simulateAssessmentSchema }), assessmentController.simulate);

  router.use(authenticate);
  // A empresa vem do JWT ou, para a equipa P4S, da criação rápida por NIF + nome.
  router.post('/', validate({ body: createAssessmentSchema }), assessmentController.create);
  router.get('/', requireCompanyScope, assessmentController.list);
  router.get('/:id', requireCompanyScope, validate({ params: idParamsSchema }), assessmentController.get);

  return router;
}
