import { useSyncExternalStore } from 'react';
import type { AuthSession } from '@engine/models/api.types';
import { USER_ROLES, isStaffRole } from '@engine/models/domain';
import { readStorage, writeStorage } from './utils';

// Sessão guardada no localStorage para sobreviver a recargas durante uma reunião.
// Contrapartida: um XSS teria acesso aos tokens. O access token dura 15 minutos e
// «Sair» invalida-os no servidor.
const KEY = 'p4s.session';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * O que está no storage pode ser de outra versão ou ter sido alterado. Uma sessão sem a
 * forma certa é ignorada: sem isto, a aplicação rebentava em todos os ecrãs até alguém
 * apagar a chave à mão.
 */
export function parseSession(raw: unknown): AuthSession | null {
  if (!isRecord(raw) || !isRecord(raw.user)) return null;
  const { user } = raw;
  const valid =
    typeof raw.accessToken === 'string' &&
    typeof raw.refreshToken === 'string' &&
    (raw.companyId === null || typeof raw.companyId === 'string') &&
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.fullName === 'string' &&
    (USER_ROLES as readonly unknown[]).includes(user.role);
  return valid ? (raw as unknown as AuthSession) : null;
}

const readSession = (): AuthSession | null => parseSession(readStorage<unknown>('local', KEY));

let current: AuthSession | null = readSession();
const listeners = new Set<() => void>();

// Outro separador entrou, saiu ou mudou de empresa: este acompanha, em vez de continuar
// com uma sessão que já não é a que está guardada.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return;
    current = readSession();
    for (const listener of listeners) listener();
  });
}

export const sessionStore = {
  get: (): AuthSession | null => current,
  set(next: AuthSession | null): void {
    current = next;
    writeStorage('local', KEY, next);
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Apaga o que a aplicação guardou neste browser (sessão e rascunhos). Último recurso quando um ecrã não abre. */
export function clearLocalData(): void {
  try {
    window.localStorage.removeItem(KEY);
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith('p4s.')) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Sem acesso ao storage não há nada para limpar.
  }
  current = null;
}

export function useSession(): AuthSession | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

export function isStaffSession(session: AuthSession | null): boolean {
  return session !== null && isStaffRole(session.user.role);
}
