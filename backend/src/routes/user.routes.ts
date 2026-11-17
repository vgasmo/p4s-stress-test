import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate, requireCompanyScope } from '../middlewares/auth.middleware.js';
import { requireRole, requireStaff } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createUserSchema, idParamsSchema, updateUserSchema } from '../models/schemas.js';

/** Gestão de utilizadores: só a equipa P4S. O alcance de cada pedido é verificado no serviço. */
export function userRoutes(): Router {
  const router = Router();
  router.use(authenticate, requireStaff);

  router.get('/', requireCompanyScope, userController.listCompanyUsers);
  // Antes de /:id para não ser apanhado como identificador.
  router.get('/team', requireRole('admin'), userController.listTeam);
  router.post('/', validate({ body: createUserSchema }), userController.create);
  router.put('/:id', validate({ params: idParamsSchema, body: updateUserSchema }), userController.update);
  router.post('/:id/password-link', validate({ params: idParamsSchema }), userController.createPasswordLink);

  return router;
}
