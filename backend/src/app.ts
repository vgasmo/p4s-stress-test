import path from 'node:path';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pool } from './config/database.js';
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

export interface AppOptions {
  /** Por omissão vem de ALLOW_INSECURE_HTTP. */
  allowInsecureHttp?: boolean;
  /** Por omissão vem de STATIC_DIR. */
  staticDir?: string;
}

/** Pedido de um ficheiro (script, estilo, imagem, tipo de letra), e não de um ecrã da aplicação. */
const STATIC_FILE = /\.(?:js|mjs|css|map|json|txt|xml|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|webmanifest)$/i;

export function createApp(options: AppOptions = {}): Express {
  const allowInsecureHttp = options.allowInsecureHttp ?? env.ALLOW_INSECURE_HTTP;
  const configuredStaticDir = options.staticDir ?? env.STATIC_DIR;
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  else app.use(proxyMisconfigurationWarning());

  app.use(
    helmet({
      contentSecurityPolicy: {
        // Por omissão o browser pede tudo por HTTPS (upgrade-insecure-requests): fora do próprio
        // computador a aplicação só abre por HTTPS, para a palavra-passe e a sessão nunca irem
        // em claro. Quem precisar mesmo de HTTP numa rede local liga ALLOW_INSECURE_HTTP.
        directives: allowInsecureHttp ? { upgradeInsecureRequests: null } : {},
      },
      // Só o próprio domínio: includeSubDomains obrigava todos os subdomínios a HTTPS durante meses.
      strictTransportSecurity: { maxAge: 15_552_000, includeSubDomains: false },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  // Só responde «ok» se a base de dados também responder.
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // As respostas da API levam dados de clientes: não ficam na cache do browser nem de proxies.
  app.use('/api/v1', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1', apiRouter());

  // Opcional: servir o frontend compilado no mesmo processo (um só porto em reunião).
  if (configuredStaticDir) {
    const staticDir = path.resolve(configuredStaticDir);
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      // As rotas da app (/, /plano/…) são resolvidas no browser; a API responde 404 em JSON.
      const pageRequest = req.method === 'GET' || req.method === 'HEAD';
      // Um ficheiro que não existe (/assets/x.js) é um 404, não a página da aplicação. Os outros
      // caminhos são ecrãs, mesmo com pontos pelo meio: é a aplicação que decide o que mostrar.
      if (!pageRequest || req.path.startsWith('/api/') || STATIC_FILE.test(req.path)) return next();
      res.set('Cache-Control', 'no-cache').sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
