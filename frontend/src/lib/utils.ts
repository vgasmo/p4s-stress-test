import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Leitura/escrita em storage que nunca rebenta (modo privado, storage bloqueado). */
export function readStorage<T>(storage: 'local' | 'session', key: string): T | null {
  try {
    const raw = (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStorage(storage: 'local' | 'session', key: string, value: unknown): void {
  try {
    const target = storage === 'local' ? window.localStorage : window.sessionStorage;
    if (value === null || value === undefined) target.removeItem(key);
    else target.setItem(key, JSON.stringify(value));
  } catch {
    // Sem storage a app continua a funcionar, só não guarda entre recargas.
  }
}
