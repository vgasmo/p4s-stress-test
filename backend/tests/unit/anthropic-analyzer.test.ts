// A chamada à API da Anthropic, contra um servidor local que faz de API. Confirma o pedido que
// o SDK envia de facto (modelo, formato da resposta, modelo de recurso) e o que a aplicação
// faz com cada tipo de resposta. Não substitui um teste com a API real.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAnthropicAnalyzer, type AnalysisFailure, type Extraction } from '../../src/services/document-analyzer.js';

interface Recorded {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

let server: Server;
let baseURL: string;
let requests: Recorded[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
      });
      if (reply.status !== 200) {
        res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
        return;
      }
      // A aplicação pede a resposta em fluxo: a mensagem segue aos bocados, como na API.
      const { content, stop_reason, ...rest } = reply.body as { content: Array<{ text: string }>; stop_reason: string };
      const event = (name: string, data: Record<string, unknown>) => res.write(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      event('message_start', { message: { ...rest, content: [], stop_reason: null } });
      content.forEach((block, index) => {
        const half = Math.ceil(block.text.length / 2);
        event('content_block_start', { index, content_block: { type: 'text', text: '' } });
        event('content_block_delta', { index, delta: { type: 'text_delta', text: block.text.slice(0, half) } });
        event('content_block_delta', { index, delta: { type: 'text_delta', text: block.text.slice(half) } });
        event('content_block_stop', { index });
      });
      event('message_delta', { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 50 } });
      event('message_stop', {});
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = [];
});

const EXTRACTION: Extraction = {
  issuer: 'Cliente',
  documentType: 'Questionário de fornecedor',
  language: 'inglês',
  documentDate: null,
  summary: 'O cliente pede EcoVadis.',
  findings: [
    {
      requirementCode: 'ecovadis',
      topic: 'EcoVadis',
      request: 'Ter avaliação EcoVadis.',
      obligation: 'mandatory',
      deadline: null,
      deadlineText: null,
      consequence: null,
      quote: 'Suppliers must hold a valid EcoVadis assessment.',
      page: 1,
    },
  ],
};

const message = (overrides: Record<string, unknown>) => ({
  id: 'msg_teste',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: JSON.stringify(EXTRACTION) }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
  ...overrides,
});

const apiError = (type: string, text: string) => ({ type: 'error', error: { type, message: text } });

const analyzer = () => createAnthropicAnalyzer({ apiKey: 'chave-de-teste', model: 'claude-opus-5-5', baseURL, maxRetries: 0 });
const INPUT = { fileName: 'q.pdf', kind: 'pdf' as const, pages: ['Suppliers must hold a valid EcoVadis assessment.', 'Página dois.'] };

async function failure(): Promise<AnalysisFailure> {
  try {
    await analyzer().analyze(INPUT);
  } catch (error) {
    return error as AnalysisFailure;
  }
  throw new Error('devia ter falhado');
}

describe('pedido à API da Anthropic', () => {
  it('envia o documento por páginas, pede a resposta em fluxo e no esquema, e ativa o modelo de recurso', async () => {
    reply = { status: 200, body: message({}) };
    const output = await analyzer().analyze(INPUT);
    expect(output).toEqual({ extraction: EXTRACTION, model: 'claude-opus-5-5' });

    expect(requests).toHaveLength(1);
    const { path, headers, body } = requests[0]!;
    expect(path).toMatch(/^\/v1\/messages/);
    expect(headers.authorization ?? headers['x-api-key']).toMatch(/chave-de-teste$/);
    expect(String(headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 32_000, stream: true, fallbacks: 'default', thinking: { type: 'adaptive' } });
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('temperature');

    const outputConfig = body.output_config as { effort: string; format: { type: string; schema: { properties: Record<string, unknown> } } };
    expect(outputConfig.effort).toBe('high');
    expect(outputConfig.format.type).toBe('json_schema');
    expect(Object.keys(outputConfig.format.schema.properties).sort()).toEqual([
      'documentDate',
      'documentType',
      'findings',
      'issuer',
      'language',
      'summary',
    ]);

    expect(String(body.system)).toMatch(/não instruções/);
    const [turn] = body.messages as Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    expect(turn?.role).toBe('user');
    expect(turn?.content[0]?.text).toContain('<pagina n="1">\nSuppliers must hold a valid EcoVadis assessment.\n</pagina>');
    expect(turn?.content[0]?.text).toContain('<pagina n="2">');
  });

  it('regista o modelo que respondeu de facto quando o pedido passou para o modelo de recurso', async () => {
    reply = { status: 200, body: message({ model: 'claude-opus-4-8' }) };
    expect((await analyzer().analyze(INPUT)).model).toBe('claude-opus-4-8');
  });
});

describe('respostas que não são um levantamento', () => {
  it('recusa do modelo', async () => {
    reply = { status: 200, body: message({ content: [], stop_reason: 'refusal' }) };
    expect(await failure()).toMatchObject({ name: 'AnalysisFailure', code: 'AI_REFUSAL' });
  });

  it('resposta cortada pelo limite de tamanho', async () => {
    reply = { status: 200, body: message({ content: [{ type: 'text', text: '{"issuer": "Cli' }], stop_reason: 'max_tokens' }) };
    expect(await failure()).toMatchObject({ code: 'AI_TRUNCATED' });
  });

  it('documento maior do que o modelo aceita', async () => {
    reply = { status: 200, body: message({ content: [], stop_reason: 'model_context_window_exceeded' }) };
    expect(await failure()).toMatchObject({ code: 'AI_TOO_LONG' });
    reply = { status: 400, body: apiError('invalid_request_error', 'prompt is too long: 250000 tokens > 200000 maximum') };
    expect(await failure()).toMatchObject({ code: 'AI_TOO_LONG' });
  });

  it('resposta sem conteúdo', async () => {
    reply = { status: 200, body: message({ content: [] }) };
    expect(await failure()).toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });
});

describe('erros da API, traduzidos para quem usa a aplicação', () => {
  it.each([
    [401, 'authentication_error', 'AI_AUTH', /ANTHROPIC_API_KEY/],
    [403, 'permission_error', 'AI_AUTH', /ANTHROPIC_API_KEY/],
    [404, 'not_found_error', 'AI_AUTH', /P4S_AI_MODEL/],
    [429, 'rate_limit_error', 'AI_RATE_LIMIT', /limite de pedidos/],
    [500, 'api_error', 'AI_UNAVAILABLE', /indisponível/],
    [529, 'overloaded_error', 'AI_UNAVAILABLE', /indisponível/],
    [400, 'invalid_request_error', 'AI_UNAVAILABLE', /recusou o pedido/],
  ])('%i %s', async (status, type, code, text) => {
    reply = { status, body: apiError(type, 'detalhe interno da API') };
    const error = await failure();
    expect(error).toMatchObject({ code });
    expect(error.message).toMatch(text);
    expect(error.message).not.toContain('detalhe interno da API');
  });

  it('servidor que não responde', async () => {
    const offline = createAnthropicAnalyzer({ apiKey: 'k', model: 'm-teste', baseURL: 'http://127.0.0.1:9', maxRetries: 0 });
    await expect(offline.analyze(INPUT)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});
