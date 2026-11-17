import type {
  ApiErrorBody,
  AssessmentDetail,
  AssessmentListEntry,
  AssignableUser,
  AuthSession,
  MeResponse,
} from '@engine/models/api.types';
import type { Company, Task } from '@engine/models/domain';
import type { CreateAssessmentInput, CreateTaskInput, UpdateTaskInput } from '@engine/models/schemas';
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

async function send(method: Method, path: string, body: unknown, token: string | null): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
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

async function request<T>(method: Method, path: string, body?: unknown, auth = true): Promise<T> {
  const token = auth ? (sessionStore.get()?.accessToken ?? null) : null;
  let response = await send(method, path, body, token);
  if (response.status === 401 && auth && token) {
    refreshing ??= refreshSession().finally(() => {
      refreshing = null;
    });
    const renewed = await refreshing;
    response = await send(method, path, body, renewed.accessToken);
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
};
