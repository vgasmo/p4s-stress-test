import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL em falta.'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET tem de ter pelo menos 32 caracteres.'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  /** Número de proxies à frente da API (0 = ligação direta). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** Pasta do frontend compilado (frontend/dist). Vazio: a API não serve ficheiros. */
  STATIC_DIR: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Configuração inválida (ver .env.example):\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
