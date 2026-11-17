import { Router } from 'express';
import { taskController } from '../controllers/task.controller.js';
import { authenticate, requireCompanyScope } from '../middlewares/auth.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createTaskSchema, idParamsSchema, taskListQuerySchema, updateTaskSchema } from '../models/schemas.js';

export function taskRoutes(): Router {
  const router = Router();
  router.use(authenticate, requireCompanyScope);

  router.get('/', validate({ query: taskListQuerySchema }), taskController.list);
  router.post('/', validate({ body: createTaskSchema }), taskController.create);
  router.get('/:id', validate({ params: idParamsSchema }), taskController.get);
  router.put('/:id', validate({ params: idParamsSchema, body: updateTaskSchema }), taskController.update);
  router.delete('/:id', requireStaff, validate({ params: idParamsSchema }), taskController.remove);

  return router;
}
