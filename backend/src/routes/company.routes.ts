import { Router } from 'express';
import { companyController } from '../controllers/company.controller.js';
import { authenticate, requireCompanyScope } from '../middlewares/auth.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createCompanySchema, idParamsSchema, updateCompanySchema } from '../models/schemas.js';

export function companyRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requireStaff, companyController.list);
  router.post('/', requireStaff, validate({ body: createCompanySchema }), companyController.create);
  // Antes de /:id para não ser apanhado como identificador.
  router.get('/current/users', requireCompanyScope, companyController.listAssignableUsers);
  router.get('/:id', validate({ params: idParamsSchema }), companyController.get);
  router.put(
    '/:id',
    requireStaff,
    validate({ params: idParamsSchema, body: updateCompanySchema }),
    companyController.update,
  );

  return router;
}
