import { describe, expect, it } from 'vitest';
import { parseSession } from './session';

const session = {
  accessToken: 'a',
  refreshToken: 'r',
  tokenType: 'Bearer',
  expiresIn: 900,
  companyId: null,
  user: { id: 'u1', email: 'admin@p4s.test', fullName: 'Administrador P4S', role: 'admin', companyId: null, isActive: true },
};

describe('sessão lida do storage', () => {
  it('aceita uma sessão com a forma certa', () => {
    expect(parseSession(session)).toBe(session);
    expect(parseSession({ ...session, companyId: 'empresa' })?.companyId).toBe('empresa');
  });

  it.each([
    ['nula', null],
    ['um número', 42],
    ['um texto', 'sessão'],
    ['sem utilizador', { ...session, user: undefined }],
    ['com papel desconhecido', { ...session, user: { ...session.user, role: 'root' } }],
    ['sem token de renovação', { ...session, refreshToken: undefined }],
    ['com empresa que não é texto', { ...session, companyId: 7 }],
  ])('ignora uma sessão %s', (_label, raw) => {
    expect(parseSession(raw)).toBeNull();
  });
});
