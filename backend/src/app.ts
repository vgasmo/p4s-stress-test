import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { apiRouter } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', apiRouter());

  // Opcional: servir o frontend compilado no mesmo processo (um só porto em reunião).
  if (env.STATIC_DIR) {
    const staticDir = path.resolve(env.STATIC_DIR);
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      // As rotas da app (/, /plano/…) são resolvidas no browser; a API responde 404 em JSON.
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
