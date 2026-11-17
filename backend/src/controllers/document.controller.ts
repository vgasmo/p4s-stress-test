import type { Request, Response } from 'express';
import { getTenant } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type { ReviewFindingInput } from '../models/schemas.js';
import { documentService } from '../services/document.service.js';
import { badRequest } from '../utils/errors.js';

/** O nome do ficheiro vem num cabeçalho, codificado como num URL (os cabeçalhos HTTP só levam ASCII). */
function fileNameFrom(req: Request): string {
  const header = req.get('x-file-name');
  if (!header) throw badRequest('Indique o nome do ficheiro no cabeçalho X-File-Name.');
  try {
    return decodeURIComponent(header);
  } catch {
    throw badRequest('O nome do ficheiro (X-File-Name) está mal codificado.');
  }
}

export const documentController = {
  async list(req: Request, res: Response): Promise<void> {
    res.json(await documentService.list(getTenant(req)));
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    res.json(await documentService.get(getTenant(req), id));
  },

  /** Corpo: os bytes do ficheiro (application/octet-stream). Responde 202: a análise corre em segundo plano. */
  async upload(req: Request, res: Response): Promise<void> {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw badRequest('Envie o ficheiro no corpo do pedido, com Content-Type application/octet-stream.');
    }
    const analysis = await documentService.upload(getTenant(req), fileNameFrom(req), body);
    res.status(202).location(`/api/v1/documents/${analysis.id}`).json(analysis);
  },

  async remove(req: Request, res: Response): Promise<void> {
    const { id } = validated<{ id: string }>(req, 'params');
    await documentService.remove(getTenant(req), id);
    res.status(204).end();
  },

  async reviewFinding(req: Request, res: Response): Promise<void> {
    const { id, findingId } = validated<{ id: string; findingId: string }>(req, 'params');
    res.json(await documentService.reviewFinding(getTenant(req), id, findingId, validated<ReviewFindingInput>(req, 'body')));
  },

  async evidence(req: Request, res: Response): Promise<void> {
    res.json(await documentService.evidence(getTenant(req)));
  },
};
