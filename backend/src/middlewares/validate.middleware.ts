import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

type Part = keyof Schemas;

/**
 * Valida body, query e params com zod. Um ZodError segue para o errorHandler (400).
 * O resultado fica em req.validated (em Express 5 req.query é só de leitura).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const validated: NonNullable<Request['validated']> = {};
    if (schemas.params) validated.params = schemas.params.parse(req.params);
    if (schemas.query) validated.query = schemas.query.parse(req.query);
    if (schemas.body) validated.body = schemas.body.parse(req.body ?? {});
    req.validated = validated;
    next();
  };
}

/** Lê o que validate guardou. T tem de corresponder ao schema usado na rota. */
export function validated<T>(req: Request, part: Part): T {
  const value = req.validated?.[part];
  if (value === undefined) throw new Error(`Rota sem validação de ${part}.`);
  return value as T;
}
