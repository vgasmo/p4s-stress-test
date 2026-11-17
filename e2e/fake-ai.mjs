// Servidor que faz de API da Anthropic no percurso ponta a ponta. NÃO é IA: devolve um
// levantamento fixo para os documentos da pasta exemplos/, para o percurso no browser poder
// correr sem chave nem custos. A aplicação fala com ele quando arranca com
// ANTHROPIC_BASE_URL=http://127.0.0.1:4010 (e uma ANTHROPIC_API_KEY qualquer).
//
// Uso: node fake-ai.mjs   (opcionais: FAKE_AI_PORT, FAKE_AI_DELAY_MS)
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_AI_PORT ?? 4010);
const DELAY_MS = Number(process.env.FAKE_AI_DELAY_MS ?? 1200);

const finding = (fields) => ({ obligation: 'mandatory', deadline: null, deadlineText: null, consequence: null, page: null, ...fields });

const QUESTIONNAIRE = {
  issuer: 'Nordwerk Automotive Systems GmbH',
  documentType: 'Requisitos de sustentabilidade e segurança da informação para fornecedores',
  language: 'inglês',
  documentDate: '2026-09-15',
  summary:
    'A Nordwerk exige aos fornecedores de moldes uma avaliação EcoVadis com 55 pontos até 30 de junho de 2027, o reporte anual das emissões dos âmbitos 1 e 2 a partir de 31 de março de 2027 e o selo TISAX nível 2 antes de novas consultas a partir de 1 de janeiro de 2027. Quem não cumprir fica fora das novas adjudicações.',
  findings: [
    finding({
      requirementCode: 'ecovadis',
      topic: 'Avaliação EcoVadis com pelo menos 55 pontos',
      request: 'Ter uma avaliação EcoVadis válida, com pontuação global mínima de 55 pontos, partilhada com o cliente na plataforma.',
      deadline: '2027-06-30',
      deadlineText: 'no later than 30 June 2027',
      consequence: 'Fica fora das novas adjudicações até demonstrar que cumpre.',
      quote: 'Suppliers must hold a valid EcoVadis assessment with a minimum overall score of 55 points no later than 30 June 2027.',
      page: 1,
    }),
    finding({
      requirementCode: 'carbon_scope_1_2',
      topic: 'Reporte anual das emissões dos âmbitos 1 e 2',
      request: 'Reportar todos os anos as emissões dos âmbitos 1 e 2 do ano anterior, calculadas segundo o GHG Protocol.',
      deadline: '2027-03-31',
      deadlineText: 'by 31 March of each year, starting on 31 March 2027',
      consequence: 'Fica fora das novas adjudicações até demonstrar que cumpre.',
      quote:
        'Suppliers shall report their Scope 1 and Scope 2 greenhouse gas emissions for the previous calendar year, calculated in accordance with the GHG Protocol Corporate Standard, by 31 March of each year, starting on 31 March 2027.',
      // Página errada de propósito: é o servidor da aplicação que diz onde a citação está.
      page: 1,
    }),
    finding({
      requirementCode: 'carbon_scope_3',
      topic: 'Emissões do âmbito 3 nas categorias 1 e 4',
      request: 'Reportar também as emissões do âmbito 3 de bens e serviços comprados e de transporte a montante.',
      obligation: 'recommended',
      deadlineText: 'From the 2028 reporting cycle onwards',
      quote:
        'suppliers are expected to also report Scope 3 emissions for purchased goods and services (category 1) and upstream transportation (category 4).',
      page: 2,
    }),
    finding({
      requirementCode: 'information_security',
      topic: 'Selo TISAX de nível 2',
      request: 'Ter o selo TISAX no nível de avaliação 2 para receber dados CAD, desenhos ou informação de protótipos.',
      deadline: '2027-01-01',
      deadlineText: 'from 1 January 2027',
      consequence: 'Não recebe novos pedidos de cotação.',
      quote:
        'must hold a valid TISAX label at Assessment Level 2 before any new request for quotation is issued to them from 1 January 2027.',
      page: 2,
    }),
    finding({
      requirementCode: 'other',
      topic: 'Assinatura do código de conduta',
      request: 'Assinar o código de conduta de fornecedores e passar exigências equivalentes aos subfornecedores.',
      quote: 'Suppliers must sign the Nordwerk Supplier Code of Conduct and cascade equivalent requirements to their own sub-suppliers.',
      page: 3,
    }),
    // Esta frase não está no documento: serve para o percurso confirmar que a aplicação a assinala.
    finding({
      requirementCode: 'other',
      topic: 'Certificação ISO 50001',
      request: 'Ter o sistema de gestão de energia certificado pela ISO 50001.',
      deadline: '2027-12-31',
      quote: 'Suppliers must be certified to ISO 50001 no later than 31 December 2027.',
      page: 2,
    }),
  ],
};

const BANK_LETTER = {
  issuer: 'Banco Exemplo, S.A.',
  documentType: 'Carta do banco sobre a renovação da linha de crédito',
  language: 'português',
  documentDate: '2026-10-06',
  summary:
    'O banco pede o questionário ESG preenchido até 15 de janeiro de 2027 para renovar a linha de crédito que vence a 30 de abril de 2027. Sem essa informação, a empresa fica no escalão de risco ESG mais elevado, com reflexo no preço.',
  findings: [
    finding({
      requirementCode: 'banking_esg',
      topic: 'Questionário ESG do banco',
      request: 'Enviar o questionário ESG preenchido, com energia, emissões dos âmbitos 1 e 2, água e resíduos de 2025.',
      deadline: '2027-01-15',
      deadlineText: 'até 15 de janeiro de 2027',
      consequence: 'Classificação no escalão de risco ESG mais elevado, com reflexo no preço da operação.',
      quote: 'solicitamos que nos enviem, até 15 de janeiro de 2027, o questionário ESG do banco preenchido',
    }),
  ],
};

const EMPTY = {
  issuer: null,
  documentType: null,
  language: null,
  documentDate: null,
  summary: 'O documento não faz exigências ao fornecedor.',
  findings: [],
};

function extractionFor(documentText) {
  if (documentText.includes('Nordwerk Automotive Systems')) return QUESTIONNAIRE;
  if (documentText.includes('Banco Exemplo')) return BANK_LETTER;
  return EMPTY;
}

const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
    return json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'rota desconhecida' } });
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let request;
    try {
      request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'corpo inválido' } });
    }
    const text = (request.messages ?? [])
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .map((block) => block.text ?? '')
      .join('\n');
    const message = {
      id: 'msg_percurso',
      type: 'message',
      role: 'assistant',
      model: `${request.model} (simulado)`,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const answer = JSON.stringify(extractionFor(text));
    setTimeout(() => {
      if (!request.stream) {
        return json(res, 200, { ...message, content: [{ type: 'text', text: answer }], stop_reason: 'end_turn' });
      }
      // A aplicação pede a resposta em fluxo: segue aos bocados, como na API verdadeira.
      const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      event('message_start', { message: { ...message, content: [], stop_reason: null } });
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (let start = 0; start < answer.length; start += 400) {
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: answer.slice(start, start + 400) } });
      }
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } });
      event('message_stop', {});
      res.end();
    }, DELAY_MS);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[ia-simulada] a responder em http://127.0.0.1:${PORT}`));
