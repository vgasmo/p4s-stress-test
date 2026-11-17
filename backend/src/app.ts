import path from 'node:path';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { apiRouter } from './routes/index.js';

/**
 * Atrás de um proxy (Codespaces, nginx, um PaaS) todos os pedidos chegam com o endereço do
 * proxy. Sem TRUST_PROXY os limites de pedidos tratam os clientes como um só, e bastam
 * algumas tentativas erradas de uma pessoa para bloquear as outras. Avisa uma vez.
 */
function proxyMisconfigurationWarning(): RequestHandler {
  let warned = false;
  return (req, _res, next) => {
    if (!warned && req.get('x-forwarded-for')) {
      warned = true;
      console.warn(
        '[api] AVISO: chegou um pedido com X-Forwarded-For e TRUST_PROXY=0. Se a API está atrás de um proxy, ' +
          'defina TRUST_PROXY com o número de proxies (normalmente 1). Sem isso, os limites de pedidos contam ' +
          'todos os clientes como um só.',
      );
    }
    next();
  };
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  else app.use(proxyMisconfigurationWarning());

  app.use(
    helmet({
      contentSecurityPolicy: {
        // Sem upgrade-insecure-requests: servida por HTTP na rede local (o portátil do consultor
        // aberto noutro computador da sala), a página ficava em branco porque o browser pedia
        // os ficheiros por HTTPS. A aplicação não carrega nada de fora, por isso não faz falta.
        directives: { upgradeInsecureRequests: null },
      },
      // Só o próprio domínio: includeSubDomains obrigava todos os subdomínios a HTTPS durante meses.
      strictTransportSecurity: { maxAge: 15_552_000, includeSubDomains: false },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // As respostas da API levam dados de clientes: não ficam na cache do browser nem de proxies.
  app.use('/api/v1', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1', apiRouter());

  // Opcional: servir o frontend compilado no mesmo processo (um só porto em reunião).
  if (env.STATIC_DIR) {
    const staticDir = path.resolve(env.STATIC_DIR);
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      // As rotas da app (/, /plano/…) são resolvidas no browser; a API responde 404 em JSON.
      const pageRequest = req.method === 'GET' || req.method === 'HEAD';
      if (!pageRequest || req.path.startsWith('/api/')) return next();
      res.set('Cache-Control', 'no-cache').sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
