import type {
  ApiErrorBody,
  AssessmentDetail,
  AssessmentListEntry,
  AssignableUser,
  AuthSession,
  CreatedUser,
  ManagedUser,
  MeResponse,
  PasswordLink,
  PasswordLinkInfo,
  PublicSimulation,
} from '@engine/models/api.types';
import type { Company, Task, UserRole } from '@engine/models/domain';
import type {
  CreateAssessmentInput,
  CreateTaskInput,
  SimulateAssessmentInput,
  UpdateTaskInput,
} from '@engine/models/schemas';
import type { Catalog } from '@engine/services/requirements';
import { sessionStore } from './session';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = Array.isArray(error.details)
      ? (error.details as { path?: string; message?: string }[])
          .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
          .join(' · ')
      : '';
    return details ? `${error.message} ${details}` : error.message;
  }
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function send(
  method: Method,
  path: string,
  body: unknown,
  token: string | null,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // Um pedido cancelado (resposta que já não interessa) não é um erro de rede.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem ligação ao servidor da P4S.');
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `Erro ${response.status}.`,
      error?.details,
    );
  }
  return payload as T;
}

// Um só refresh em curso, mesmo com vários pedidos a falhar ao mesmo tempo.
let refreshing: Promise<AuthSession> | null = null;

async function refreshSession(companyId?: string | null): Promise<AuthSession> {
  const session = sessionStore.get();
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Sessão terminada.');
  const response = await send(
    'POST',
    '/auth/refresh',
    { refreshToken: session.refreshToken, ...(companyId !== undefined ? { companyId } : {}) },
    null,
  );
  if (response.status === 401) sessionStore.set(null);
  const next = await parse<AuthSession>(response);
  sessionStore.set(next);
  return next;
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  auth = true,
  signal?: AbortSignal,
): Promise<T> {
  const token = auth ? (sessionStore.get()?.accessToken ?? null) : null;
  let response = await send(method, path, body, token, signal);
  if (response.status === 401 && auth && token) {
    refreshing ??= refreshSession().finally(() => {
      refreshing = null;
    });
    const renewed = await refreshing;
    response = await send(method, path, body, renewed.accessToken, signal);
  }
  return parse<T>(response);
}

/** Corpo de POST /assessments tal como o formulário o envia (defaults aplicados no servidor). */
export type CreateAssessmentPayload = Omit<CreateAssessmentInput, 'creditLineToRefinance'> & {
  creditLineToRefinance: number;
};

export type CreateTaskPayload = Partial<CreateTaskInput> & Pick<CreateTaskInput, 'assessmentId' | 'title' | 'domain'>;

export const api = {
  login: (email: string, password: string) =>
    request<AuthSession>('POST', '/auth/login', { email, password }, false),
  /** Renova a sessão; com companyId muda a empresa selecionada (equipa P4S). */
  switchCompany: (companyId: string | null) => refreshSession(companyId),
  me: () => request<MeResponse>('GET', '/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<AuthSession>('POST', '/auth/change-password', { currentPassword, newPassword }),
  /** Dados do link de palavra-passe (quem é, até quando vale), antes de o utilizador escrever. */
  inspectPasswordLink: (token: string) =>
    request<PasswordLinkInfo>('POST', '/auth/password-link/inspect', { token }, false),
  setPassword: (token: string, password: string) =>
    request<AuthSession>('POST', '/auth/set-password', { token, password }, false),

  /** Pesos, pisos, preços e prazos. Só com sessão: não fazem parte do código público. */
  getCatalog: () => request<Catalog>('GET', '/catalog'),
  /** Simulação sem sessão: ordens de grandeza por escalões, sem pesos nem preços. */
  simulatePublic: (input: SimulateAssessmentInput, signal?: AbortSignal) =>
    request<PublicSimulation>('POST', '/assessments/simulate', input, false, signal),

  listAssessments: () => request<AssessmentListEntry[]>('GET', '/assessments'),
  getAssessment: (id: string) => request<AssessmentDetail>('GET', `/assessments/${id}`),
  createAssessment: (payload: CreateAssessmentPayload) =>
    request<AssessmentDetail>('POST', '/assessments', payload),

  listTasks: (assessmentId: string) =>
    request<Task[]>('GET', `/tasks?assessment_id=${encodeURIComponent(assessmentId)}`),
  createTask: (payload: CreateTaskPayload) => request<Task>('POST', '/tasks', payload),
  updateTask: (id: string, patch: UpdateTaskInput) => request<Task>('PUT', `/tasks/${id}`, patch),
  deleteTask: (id: string) => request<void>('DELETE', `/tasks/${id}`),

  listCompanies: () => request<Company[]>('GET', '/companies'),
  listAssignableUsers: () => request<AssignableUser[]>('GET', '/companies/current/users'),

  /** Utilizadores da empresa selecionada (equipa P4S). */
  listCompanyUsers: () => request<ManagedUser[]>('GET', '/users'),
  /** Equipa P4S (só administradores). */
  listTeam: () => request<ManagedUser[]>('GET', '/users/team'),
  createUser: (payload: { email: string; fullName: string; role?: UserRole }) =>
    request<CreatedUser>('POST', '/users', payload),
  updateUser: (id: string, patch: { fullName?: string; isActive?: boolean }) =>
    request<ManagedUser>('PUT', `/users/${id}`, patch),
  createPasswordLink: (id: string) => request<PasswordLink>('POST', `/users/${id}/password-link`),
};
