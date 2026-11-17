import type { Request, Response } from 'express';
import { getTenant } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type { CreateTaskInput, TaskListQuery, UpdateTaskInput } from '../models/schemas.js';
import { taskService } from '../services/task.service.js';

export const taskController = {
  async list(req: Request, res: Response): Promise<void> {
    res.json(await taskService.list(getTenant(req), validated<TaskListQuery>(req, 'query')));
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await taskService.get(getTenant(req), id));
  },

  async create(req: Request, res: Response): Promise<void> {
    const task = await taskService.create(getTenant(req), validated<CreateTaskInput>(req, 'body'));
    res.status(201).location(`/api/v1/tasks/${task.id}`).json(task);
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await taskService.update(getTenant(req), id, validated<UpdateTaskInput>(req, 'body')));
  },

  async remove(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    await taskService.remove(getTenant(req), id);
    res.status(204).end();
  },
};
