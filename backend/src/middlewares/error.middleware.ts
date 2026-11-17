import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../models/api.types.js';
import { AppError, notFound } from '../utils/errors.js';

export const notFoundHandler: RequestHandler = (req) => {
  throw notFound(`Rota inexistente: ${req.method} ${req.path}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Erros do Express e dos seus parsers trazem o código HTTP em status ou statusCode. */
function clientErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = typeof error.status === 'number' ? error.status : error.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

const errorType = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.type === 'string' ? error.type : undefined;

const pgCode = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;

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

  // Pedido mal formado (JSON inválido, corpo comprimido ilegível, parâmetro mal codificado,
  // corpo demasiado grande): a culpa é de quem envia, por isso 4xx e nada no registo de erros.
  const status = clientErrorStatus(error);
  if (status !== undefined) {
    const message =
      status === 413
        ? 'Pedido demasiado grande.'
        : errorType(error) === 'entity.parse.failed'
          ? 'JSON inválido.'
          : 'Pedido inválido.';
    send(res, status, { error: { code: 'BAD_REQUEST', message } });
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
  // Classe 22: valor que a base de dados não consegue guardar (fora dos limites, carácter inválido).
  if (code?.startsWith('22')) {
    send(res, 400, { error: { code: 'BAD_REQUEST', message: 'Dados inválidos: há um valor fora dos limites aceites.' } });
    return;
  }

  console.error('[api] erro não tratado', error);
  send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } });
};
