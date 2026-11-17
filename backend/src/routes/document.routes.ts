import express, { Router } from 'express';
import { documentController } from '../controllers/document.controller.js';
import { authenticate, requireCompanyScope } from '../middlewares/auth.middleware.js';
import { documentUploadLimiter } from '../middlewares/rate-limit.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { findingParamsSchema, idParamsSchema, reviewFindingSchema } from '../models/schemas.js';
import { MAX_DOCUMENT_BYTES } from '../services/document-text.js';

/** /api/v1/documents: análise de documentos com IA. Só a equipa P4S carrega e revê. */
export function documentRoutes(): Router {
  const router = Router();
  router.use(authenticate, requireCompanyScope);

  // A empresa vê a evidência já confirmada (é o que aparece no plano e no resumo impresso).
  router.get('/evidence', documentController.evidence);

  router.use(requireStaff);
  router.get('/', documentController.list);
  // O corpo só é lido depois de confirmada a sessão e o papel: ninguém de fora ocupa memória.
  router.post(
    '/',
    documentUploadLimiter,
    express.raw({ type: 'application/octet-stream', limit: MAX_DOCUMENT_BYTES }),
    documentController.upload,
  );
  router.get('/:id', validate({ params: idParamsSchema }), documentController.get);
  router.delete('/:id', validate({ params: idParamsSchema }), documentController.remove);
  router.patch(
    '/:id/findings/:findingId',
    validate({ params: findingParamsSchema, body: reviewFindingSchema }),
    documentController.reviewFinding,
  );

  return router;
}
