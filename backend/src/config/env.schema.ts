// Regras da configuração (variáveis de ambiente). Sem efeitos ao importar, para se poderem testar.

import { z } from 'zod';
import { looksGenerated } from '../utils/secret-strength.js';

// As mensagens que o zod gera sozinho saem em português, também aqui (a configuração é lida
// antes dos contratos da API, que é onde o idioma era definido).
z.config(z.locales.pt());

/** Valores que aparecem em exemplos e documentação. Um segredo conhecido deixa forjar sessões. */
const PLACEHOLDER_SECRET = /troca-isto|change-?me|changeme|your-?secret/i;

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'], { error: 'NODE_ENV só aceita development, test ou production.' })
      .default('development'),
    PORT: z.coerce
      .number({ error: 'PORT tem de ser um número de porto (1 a 65535).' })
      .int('PORT tem de ser um número de porto (1 a 65535).')
      .min(1, 'PORT tem de ser um número de porto (1 a 65535).')
      .max(65_535, 'PORT tem de ser um número de porto (1 a 65535).')
      .default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL em falta.'),
    JWT_SECRET: z
      .string({ error: 'JWT_SECRET em falta. Gere um com: openssl rand -base64 48' })
      .min(32, 'JWT_SECRET tem de ter pelo menos 32 caracteres. Gere um com: openssl rand -base64 48')
      .refine(
        (value) => !PLACEHOLDER_SECRET.test(value),
        'JWT_SECRET ainda tem um valor de exemplo. Gere um com: openssl rand -base64 48',
      ),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
    /** Duração máxima de uma sessão, por muito que seja renovada. Depois disso é preciso entrar outra vez. */
    SESSION_MAX_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    /** Número de proxies à frente da API (0 = ligação direta). */
    TRUST_PROXY: z.coerce
      .number({ error: 'TRUST_PROXY é o número de proxies à frente da API (0, 1, …).' })
      .int('TRUST_PROXY é o número de proxies à frente da API (0, 1, …).')
      .min(0, 'TRUST_PROXY é o número de proxies à frente da API (0, 1, …).')
      .default(0),
    /**
     * Permite usar a aplicação por HTTP simples fora do próprio computador (rede local, sem
     * certificado). Desligado por omissão: sem HTTPS, a palavra-passe e a sessão passam em
     * claro na rede, por isso o browser é instruído a pedir tudo por HTTPS.
     */
    ALLOW_INSECURE_HTTP: z
      .string()
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(['true', 'false'], { error: 'ALLOW_INSECURE_HTTP só aceita true ou false.' }))
      .default('false')
      .transform((value) => value === 'true'),
    /** Email de contacto da P4S, mostrado a quem ainda não tem conta. Vazio: não aparece. */
    P4S_CONTACT_EMAIL: z
      .string()
      .optional()
      .transform((value) => value?.trim() || undefined)
      .pipe(z.email('P4S_CONTACT_EMAIL não é um email válido.').optional()),
    /** Identificação de quem emite a proposta (denominação, NIF, morada), impressa no resumo. */
    P4S_LEGAL_IDENTITY: z
      .string()
      .max(300, 'P4S_LEGAL_IDENTITY: máximo 300 caracteres.')
      .optional()
      .transform((value) => value?.trim() || undefined),
    /**
     * Condições da proposta impressas no resumo (IVA, pagamento, quem é o parceiro), uma por
     * linha separadas por «|». São texto da P4S: a aplicação não as inventa.
     */
    P4S_PROPOSAL_TERMS: z
      .string()
      .max(900, 'P4S_PROPOSAL_TERMS: máximo 900 caracteres.')
      .optional()
      .transform((value) =>
        (value ?? '')
          .split('|')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      ),
    /** Pasta do frontend compilado (frontend/dist). Vazio: a API não serve ficheiros. */
    STATIC_DIR: z
      .string()
      .optional()
      .transform((value) => value?.trim() || undefined),
  })
  // Em produção, uma frase, uma repetição ou uma sequência não servem: quem adivinhar o segredo forja sessões.
  .refine((config) => config.NODE_ENV !== 'production' || looksGenerated(config.JWT_SECRET), {
    path: ['JWT_SECRET'],
    message:
      'Em produção o JWT_SECRET tem de ser um valor gerado, não uma frase, uma repetição ou uma sequência. Gere um com: openssl rand -base64 48',
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Lê e valida a configuração. Uma linha vazia no .env («PORT=») conta como ausente: fica o
 * valor por omissão, em vez de a API recusar arrancar por causa de um campo por preencher.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const filled = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''));
  const parsed = envSchema.safeParse(filled);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuração inválida (ver .env.example):\n${details}`);
  }
  return parsed.data;
}
