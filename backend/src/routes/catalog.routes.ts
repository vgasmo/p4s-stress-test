import { Router } from 'express';
import { catalogController } from '../controllers/catalog.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

export function catalogRoutes(): Router {
  const router = Router();
  // Só com sessão: o catálogo não é público.
  router.get('/', authenticate, catalogController.get);
  return router;
}
