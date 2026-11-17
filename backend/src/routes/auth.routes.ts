import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { loginLimiter, passwordLinkLimiter, refreshLimiter } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  changePasswordSchema,
  inspectPasswordLinkSchema,
  loginSchema,
  refreshSchema,
  setPasswordSchema,
} from '../models/schemas.js';

export function authRoutes(): Router {
  const router = Router();
  router.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);
  router.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), authController.refresh);
  router.get('/me', authenticate, authController.me);

  // Links de palavra-passe (convite e recuperação). O token vai no corpo, nunca no URL.
  router.post(
    '/password-link/inspect',
    passwordLinkLimiter,
    validate({ body: inspectPasswordLinkSchema }),
    authController.inspectPasswordLink,
  );
  router.post('/set-password', passwordLinkLimiter, validate({ body: setPasswordSchema }), authController.setPassword);
  router.post(
    '/change-password',
    authenticate,
    passwordLinkLimiter,
    validate({ body: changePasswordSchema }),
    authController.changePassword,
  );
  return router;
}
