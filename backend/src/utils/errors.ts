export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Autenticação necessária.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Sem permissão para esta operação.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Recurso não encontrado.') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export const companyScopeRequired = () =>
  new AppError(
    400,
    'COMPANY_SCOPE_REQUIRED',
    'Sessão sem empresa selecionada. Escolha a empresa em /auth/refresh com companyId.',
  );
