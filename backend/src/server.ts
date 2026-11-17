import { createApp } from './app.js';
import { pool } from './config/database.js';
import { env } from './config/env.js';

const server = createApp().listen(env.PORT, () => {
  console.log(`[api] P4S Stress Test em http://localhost:${env.PORT}/api/v1`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[api] ${signal} recebido, a terminar`);
  server.close(() => {
    pool
      .end()
      .catch((error: unknown) => console.error('[db] erro ao fechar o pool', error))
      .finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
