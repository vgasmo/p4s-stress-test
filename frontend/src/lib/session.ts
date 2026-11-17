import { useSyncExternalStore } from 'react';
import type { AuthSession } from '@engine/models/api.types';
import { isStaffRole } from '@engine/models/domain';
import { readStorage, writeStorage } from './utils';

// Sessão guardada no localStorage para sobreviver a recargas durante uma reunião.
// Contrapartida: um XSS teria acesso aos tokens. O access token dura 15 minutos e
// «Sair» invalida-os no servidor.
const KEY = 'p4s.session';

let current: AuthSession | null = readStorage<AuthSession>('local', KEY);
const listeners = new Set<() => void>();

// Outro separador entrou, saiu ou mudou de empresa: este acompanha, em vez de continuar
// com uma sessão que já não é a que está guardada.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return;
    current = readStorage<AuthSession>('local', KEY);
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

export function useSession(): AuthSession | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

export function isStaffSession(session: AuthSession | null): boolean {
  return session !== null && isStaffRole(session.user.role);
}
