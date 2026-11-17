import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../models/api.types.js';
import { AppError, notFound } from '../utils/errors.js';

export const notFoundHandler: RequestHandler = (req) => {
  throw notFound(`Rota inexistente: ${req.method} ${req.path}`);
};

interface BodyParserError {
  type: string;
  status: number;
}

const isBodyParserError = (error: unknown): error is BodyParserError =>
  typeof error === 'object' && error !== null && 'type' in error && 'status' in error;

const pgCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const send = (res: Parameters<ErrorRequestHandler>[2], status: number, body: ApiErrorBody) => {
  res.status(status).json(body);
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    send(res, error.status, {
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }

  if (error instanceof ZodError) {
    send(res, 400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos.',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }

  if (isBodyParserError(error)) {
    const tooLarge = error.type === 'entity.too.large';
    send(res, tooLarge ? 413 : 400, {
      error: { code: 'BAD_REQUEST', message: tooLarge ? 'Pedido demasiado grande.' : 'JSON inválido.' },
    });
    return;
  }

  const code = pgCode(error);
  if (code === '23505') {
    send(res, 409, { error: { code: 'CONFLICT', message: 'Já existe um registo com esses dados.' } });
    return;
  }
  if (code === '23503' || code === '23514') {
    send(res, 400, { error: { code: 'BAD_REQUEST', message: 'Dados incompatíveis com registos existentes.' } });
    return;
  }

  console.error('[api] erro não tratado', error);
  send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } });
};
