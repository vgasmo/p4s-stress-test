import { pendingMigrations } from '../scripts/migrate.js';
import { createApp } from './app.js';
import { pool } from './config/database.js';
import { env } from './config/env.js';

/**
 * A API não arranca com a base de dados desatualizada: falhava mais tarde, a meio de um
 * pedido, com um erro que não diz o que falta fazer.
 */
async function assertDatabaseIsReady(): Promise<void> {
  let pending: string[];
  try {
    pending = await pendingMigrations(pool);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn('[api] Pasta db/migrations não encontrada: não foi verificado se a base de dados está atualizada.');
      return;
    }
    console.error('[api] Não foi possível ligar à base de dados (DATABASE_URL).', (error as Error).message);
    process.exit(1);
  }
  if (pending.length > 0) {
    console.error(`[api] Há migrações por aplicar (${pending.join(', ')}). Corra «npm run db:migrate» e volte a arrancar.`);
    process.exit(1);
  }
}

await assertDatabaseIsReady();

// O Express chama esta função também quando não consegue abrir o porto. Sem tratar o erro, a
// API dizia que tinha arrancado e terminava sozinha pouco depois, com quem estava a testar a
// falar para o processo antigo que ainda ocupava o porto.
const server = createApp().listen(env.PORT, (error?: Error) => {
  if (error) {
    console.error(
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `[api] O porto ${env.PORT} já está a ser usado por outro processo. Pare-o ou mude PORT.`
        : `[api] Não foi possível abrir o porto ${env.PORT}: ${error.message}`,
    );
    process.exit(1);
  }
  console.log(`[api] P4S Stress Test em http://localhost:${env.PORT}/api/v1`);
  console.log(
    env.TRUST_PROXY > 0
      ? `[api] TRUST_PROXY=${env.TRUST_PROXY}: o endereço dos clientes é lido do proxy à frente da API.`
      : '[api] TRUST_PROXY=0: ligação direta. Atrás de um proxy (Codespaces, nginx, um PaaS) defina TRUST_PROXY=1.',
  );
  if (env.STATIC_DIR) {
    console.log(
      env.ALLOW_INSECURE_HTTP
        ? '[api] ALLOW_INSECURE_HTTP=true: a aplicação abre por HTTP simples. A palavra-passe e a sessão passam em claro na rede.'
        : '[api] Fora deste computador a aplicação só abre por HTTPS (ou com ALLOW_INSECURE_HTTP=true, numa rede de confiança).',
    );
  }
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
