import 'dotenv/config';
import { z } from 'zod';

/** Valores que aparecem em exemplos e documentação. Um segredo conhecido deixa forjar sessões. */
const PLACEHOLDER_SECRET = /troca-isto|change-?me|changeme|your-?secret/i;
/** Em produção, uma frase legível também não serve: o segredo tem de ser gerado. */
const READABLE_SECRET = /segredo|secret|exemplo|example|password|palavra-passe|desenvolvimento|teste/i;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
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
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** Pasta do frontend compilado (frontend/dist). Vazio: a API não serve ficheiros. */
    STATIC_DIR: z
      .string()
      .optional()
      .transform((value) => value?.trim() || undefined),
  })
  .refine((config) => config.NODE_ENV !== 'production' || !READABLE_SECRET.test(config.JWT_SECRET), {
    path: ['JWT_SECRET'],
    message: 'Em produção o JWT_SECRET tem de ser gerado (openssl rand -base64 48), não uma frase.',
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Configuração inválida (ver .env.example):\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
