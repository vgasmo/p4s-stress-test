import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Os testes de integração partilham a mesma base de dados.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://p4s:p4s@localhost:5432/p4s_test',
      JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres-0123456789',
      BCRYPT_ROUNDS: '4',
    },
  },
});
