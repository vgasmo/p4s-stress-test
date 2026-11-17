import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.schema.js';

/** Segredo com a forma do que «openssl rand -base64 48» produz. */
const GENERATED = 'k3Jx9mQ2vT8nR5wZ7bLp1cY6dF4hG0sAeUiOqWtEyXzKjHgFdSaPoIuYtReWq1M2';
const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_SECRET: GENERATED };
const error = (source: Record<string, string | undefined>) => {
  try {
    parseEnv(source);
    return null;
  } catch (cause) {
    return (cause as Error).message;
  }
};

describe('configuração', () => {
  it('com o mínimo, usa os valores por omissão', () => {
    expect(parseEnv(base)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY: 0,
      ALLOW_INSECURE_HTTP: false,
      JWT_ACCESS_TTL_SECONDS: 900,
      SESSION_MAX_TTL_SECONDS: 2_592_000,
      P4S_PROPOSAL_TERMS: [],
    });
  });

  it('uma linha vazia no .env conta como ausente, em vez de impedir o arranque', () => {
    const config = parseEnv({ ...base, PORT: '', NODE_ENV: '', ALLOW_INSECURE_HTTP: ' ', TRUST_PROXY: '', P4S_CONTACT_EMAIL: '' });
    expect(config).toMatchObject({ PORT: 3000, NODE_ENV: 'development', ALLOW_INSECURE_HTTP: false, TRUST_PROXY: 0 });
    expect(config.P4S_CONTACT_EMAIL).toBeUndefined();
  });

  it('diz em português o que está errado e em que variável', () => {
    expect(error({ ...base, ALLOW_INSECURE_HTTP: '1' })).toContain('ALLOW_INSECURE_HTTP: ALLOW_INSECURE_HTTP só aceita true ou false.');
    expect(error({ ...base, TRUST_PROXY: 'true' })).toContain('TRUST_PROXY é o número de proxies à frente da API');
    expect(error({ ...base, PORT: '0' })).toContain('PORT tem de ser um número de porto (1 a 65535).');
    expect(error({ ...base, NODE_ENV: 'prod' })).toContain('NODE_ENV só aceita development, test ou production.');
    expect(error({ ...base, P4S_CONTACT_EMAIL: 'abc' })).toContain('P4S_CONTACT_EMAIL não é um email válido.');
    expect(error({ JWT_SECRET: GENERATED })).toMatch(/DATABASE_URL: /);
  });

  it('ALLOW_INSECURE_HTTP aceita true e false sem distinguir maiúsculas', () => {
    expect(parseEnv({ ...base, ALLOW_INSECURE_HTTP: 'TRUE' }).ALLOW_INSECURE_HTTP).toBe(true);
    expect(parseEnv({ ...base, ALLOW_INSECURE_HTTP: 'False' }).ALLOW_INSECURE_HTTP).toBe(false);
  });

  it('as condições da proposta são uma por linha, separadas por «|»', () => {
    expect(parseEnv({ ...base, P4S_PROPOSAL_TERMS: ' IVA à taxa legal | | 50% na adjudicação ' }).P4S_PROPOSAL_TERMS).toEqual([
      'IVA à taxa legal',
      '50% na adjudicação',
    ]);
  });

  describe('JWT_SECRET', () => {
    it('é obrigatório, tem pelo menos 32 caracteres e não pode ser o valor de exemplo, em qualquer ambiente', () => {
      expect(error({ DATABASE_URL: base.DATABASE_URL })).toContain('JWT_SECRET em falta');
      expect(error({ ...base, JWT_SECRET: '' })).toContain('JWT_SECRET em falta');
      expect(error({ ...base, JWT_SECRET: 'curto' })).toContain('pelo menos 32 caracteres');
      expect(error({ ...base, JWT_SECRET: 'troca-isto-por-um-segredo-com-pelo-menos-32-caracteres' })).toContain('valor de exemplo');
    });

    it('em desenvolvimento e em teste aceita uma frase comprida', () => {
      const phrase = 'uma-frase-comprida-so-para-desenvolver-na-minha-maquina';
      expect(parseEnv({ ...base, JWT_SECRET: phrase }).JWT_SECRET).toBe(phrase);
      expect(parseEnv({ ...base, NODE_ENV: 'test', JWT_SECRET: phrase }).JWT_SECRET).toBe(phrase);
    });

    it.each([
      ['uma frase', 'plan4sustain-leiria-2026-chave-da-api-jwt-de-producao'],
      ['um carácter repetido', 'a'.repeat(64)],
      ['algarismos seguidos', '12345678901234567890123456789012'],
      ['espaços', ' '.repeat(40) + 'x'],
      ['o nome da empresa repetido', 'plan4sustain-plan4sustain-plan4sustain'],
    ])('em produção recusa %s', (_label, secret) => {
      expect(error({ ...base, NODE_ENV: 'production', JWT_SECRET: secret })).toContain('tem de ser um valor gerado');
    });

    it('em produção aceita um valor gerado', () => {
      expect(parseEnv({ ...base, NODE_ENV: 'production' }).JWT_SECRET).toBe(GENERATED);
      const hex = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
      expect(parseEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: hex }).JWT_SECRET).toBe(hex);
    });
  });
});
