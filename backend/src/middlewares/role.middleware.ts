import type { RequestHandler } from 'express';
import { STAFF_ROLES, type UserRole } from '../models/domain.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export function requireRole(...roles: readonly UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

/** Admin ou consultor P4S. */
export const requireStaff = requireRole(...STAFF_ROLES);
