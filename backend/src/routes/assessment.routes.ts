import { Router } from 'express';
import { assessmentController } from '../controllers/assessment.controller.js';
import { authenticate, authenticateOptional, requireCompanyScope } from '../middlewares/auth.middleware.js';
import { simulateLimiter } from '../middlewares/rate-limit.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createAssessmentSchema, idParamsSchema, simulateAssessmentSchema } from '../models/schemas.js';

export function assessmentRoutes(): Router {
  const router = Router();

  // Público, nada é gravado. Só a equipa P4S recebe o cálculo completo: os outros recebem
  // ordens de grandeza, sem pesos nem preços.
  router.post(
    '/simulate',
    simulateLimiter,
    authenticateOptional,
    validate({ body: simulateAssessmentSchema }),
    assessmentController.simulate,
  );

  router.use(authenticate);
  // Só a equipa P4S grava diagnósticos. A empresa vem do JWT ou da criação rápida por NIF + nome.
  router.post('/', requireStaff, validate({ body: createAssessmentSchema }), assessmentController.create);
  router.get('/', requireCompanyScope, assessmentController.list);
  router.get('/:id', requireCompanyScope, validate({ params: idParamsSchema }), assessmentController.get);
  router.post(
    '/:id/reissue-proposal',
    requireStaff,
    requireCompanyScope,
    validate({ params: idParamsSchema }),
    assessmentController.reissueProposal,
  );
  router.delete(
    '/:id',
    requireStaff,
    requireCompanyScope,
    validate({ params: idParamsSchema }),
    assessmentController.remove,
  );

  return router;
}
