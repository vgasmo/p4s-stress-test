import { Router } from 'express';
import { catalogController } from '../controllers/catalog.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';

export function catalogRoutes(): Router {
  const router = Router();
  // Só a equipa P4S: pesos, pisos e tabela de preços não saem para clientes nem para fora.
  router.get('/', authenticate, requireStaff, catalogController.get);
  return router;
}
