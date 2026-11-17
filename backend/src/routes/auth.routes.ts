import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { loginLimiter, refreshLimiter } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { loginSchema, refreshSchema } from '../models/schemas.js';

export function authRoutes(): Router {
  const router = Router();
  router.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);
  router.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), authController.refresh);
  router.get('/me', authenticate, authController.me);
  return router;
}
