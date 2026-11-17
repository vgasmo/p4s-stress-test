import { Router } from 'express';
import { assessmentRoutes } from './assessment.routes.js';
import { authRoutes } from './auth.routes.js';
import { catalogRoutes } from './catalog.routes.js';
import { companyRoutes } from './company.routes.js';
import { taskRoutes } from './task.routes.js';
import { userRoutes } from './user.routes.js';

/** /api/v1 */
export function apiRouter(): Router {
  const router = Router();
  router.use('/auth', authRoutes());
  router.use('/catalog', catalogRoutes());
  router.use('/assessments', assessmentRoutes());
  router.use('/tasks', taskRoutes());
  router.use('/companies', companyRoutes());
  router.use('/users', userRoutes());
  return router;
}
