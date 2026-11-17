import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, extractionSchema, renderDocument, type Extraction } from '../../src/services/document-analyzer.js';
import { cleanFileName, toFindings } from '../../src/services/document.service.js';
import { REQUIREMENTS } from '../../src/services/requirements.js';

const PAGES = [
  'Suppliers must hold a valid EcoVadis assessment with a minimum overall score of 55 points no later than 30 June 2027.',
  'Suppliers shall report their Scope 1 and Scope 2 greenhouse gas emissions by 31 March of each year. Suppliers must sign the Code of Conduct.',
];

type Item = Extraction['findings'][number];
const item = (overrides: Partial<Item>): Item => ({
  requirementCode: 'ecovadis',
  topic: 'Avaliação EcoVadis',
  request: 'Ter uma avaliação EcoVadis com pelo menos 55 pontos.',
  obligation: 'mandatory',
  deadline: '2027-06-30',
  deadlineText: 'no later than 30 June 2027',
  consequence: null,
  quote: 'Suppliers must hold a valid EcoVadis assessment with a minimum overall score of 55 points',
  page: 1,
  ...overrides,
});
const extraction = (findings: Item[]): Extraction => ({
  issuer: 'Cliente',
  documentType: 'Questionário',
  language: 'inglês',
  documentDate: null,
  summary: 'Resumo.',
  findings,
});

describe('do que a IA devolve ao que se guarda', () => {
  it('verifica cada citação no texto e guarda a página onde o servidor a encontrou', () => {
    const [found] = toFindings(extraction([item({ page: 2 })]), { kind: 'pdf', pages: PAGES });
    expect(found).toMatchObject({ requirementCode: 'ecovadis', quoteVerified: true, quotePage: 1, deadline: '2027-06-30' });
  });

  it('marca como não verificada a citação que não está no documento', () => {
    const [invented] = toFindings(
      extraction([item({ quote: 'Suppliers must be certified to ISO 14001 before 2027.', page: 1 })]),
      { kind: 'pdf', pages: PAGES },
    );
    expect(invented).toMatchObject({ quoteVerified: false, quotePage: null });
  });

  it('«other» fica sem requisito, e os documentos sem páginas ficam sem página', () => {
    const [other] = toFindings(
      extraction([item({ requirementCode: 'other', quote: 'Suppliers must sign the Code of Conduct.', page: 2 })]),
      { kind: 'docx', pages: [PAGES.join('\n')] },
    );
    expect(other).toMatchObject({ requirementCode: null, quoteVerified: true, quotePage: null });
  });

  it('um prazo que não é uma data válida fica como texto, e não se perde', () => {
    const [relative, impossible, both] = toFindings(
      extraction([
        item({ deadline: 'within 90 days', deadlineText: null }),
        item({ deadline: '2027-02-30', deadlineText: null, request: 'Outro pedido.' }),
        item({ deadline: '2027-13-01', deadlineText: 'no later than the audit', request: 'Terceiro pedido.' }),
      ]),
      { kind: 'pdf', pages: PAGES },
    );
    expect(relative).toMatchObject({ deadline: null, deadlineText: 'within 90 days' });
    expect(impossible).toMatchObject({ deadline: null, deadlineText: '2027-02-30' });
    expect(both).toMatchObject({ deadline: null, deadlineText: 'no later than the audit' });
  });

  it('deixa de fora linhas sem citação ou sem pedido, e as repetidas', () => {
    const findings = toFindings(
      extraction([
        item({}),
        item({}),
        item({ quote: '   ' }),
        item({ request: ' \n ' }),
        item({ requirementCode: 'carbon_scope_1_2' }),
      ]),
      { kind: 'pdf', pages: PAGES },
    );
    expect(findings.map((finding) => finding.requirementCode)).toEqual(['ecovadis', 'carbon_scope_1_2']);
  });

  it('arruma os textos: uma linha, sem espaços a mais, dentro dos limites da base de dados', () => {
    const [finding] = toFindings(
      extraction([
        item({
          topic: `  Avaliação\n EcoVadis ${'x'.repeat(300)}`,
          request: 'Pedido  com\n\nquebras.',
          consequence: '   ',
          deadlineText: 'y'.repeat(400),
        }),
      ]),
      { kind: 'pdf', pages: PAGES },
    );
    expect(finding?.topic.length).toBe(200);
    expect(finding?.topic.startsWith('Avaliação EcoVadis x')).toBe(true);
    expect(finding?.request).toBe('Pedido com quebras.');
    expect(finding?.consequence).toBeNull();
    expect(finding?.deadlineText?.length).toBe(300);
  });

  it('um título vazio é substituído pelo pedido', () => {
    const [finding] = toFindings(extraction([item({ topic: '  ' })]), { kind: 'pdf', pages: PAGES });
    expect(finding?.topic).toBe('Ter uma avaliação EcoVadis com pelo menos 55 pontos.');
  });
});

describe('nome do ficheiro', () => {
  it('fica sem caminho, sem caracteres de controlo e numa linha', () => {
    expect(cleanFileName('C:\\Clientes\\Nordwerk\\Questionário 2026.pdf')).toBe('Questionário 2026.pdf');
    expect(cleanFileName('/tmp/../etc/passwd')).toBe('passwd');
    expect(cleanFileName('  carta\r\n do\tbanco\u0000.docx ')).toBe('carta do banco .docx');
    expect(cleanFileName('fatura\u202Efdp.exe')).toBe('fatura fdp.exe');
    expect(cleanFileName(`${'a'.repeat(300)}.pdf`)).toHaveLength(255);
    expect(cleanFileName(`${'a'.repeat(300)}.pdf`).endsWith('.pdf')).toBe(true);
  });

  it('recusa um nome vazio', () => {
    expect(() => cleanFileName('')).toThrow(/nome do ficheiro/);
    expect(() => cleanFileName('pasta/')).toThrow(/nome do ficheiro/);
    expect(() => cleanFileName(' \n ')).toThrow(/nome do ficheiro/);
  });
});

describe('pedido à IA', () => {
  it('numera as páginas dos PDF, para a citação poder dizer onde está', () => {
    const text = renderDocument({ fileName: 'q "x".pdf', kind: 'pdf', pages: ['um', 'dois'] });
    expect(text).toBe('<documento nome="q \\"x\\".pdf">\n<pagina n="1">\num\n</pagina>\n<pagina n="2">\ndois\n</pagina>\n</documento>');
    expect(renderDocument({ fileName: 'c.docx', kind: 'docx', pages: ['texto'] })).toBe('<documento nome="c.docx">\ntexto\n</documento>');
  });

  it('as instruções tratam o documento como dados e descrevem todos os requisitos do stress test', () => {
    expect(SYSTEM_PROMPT).toMatch(/não instruções/);
    for (const requirement of REQUIREMENTS) expect(SYSTEM_PROMPT).toContain(`- ${requirement.code}: ${requirement.label}`);
  });

  it('o esquema da resposta converte-se num JSON Schema fechado, como a API exige', () => {
    const format = betaZodOutputFormat(extractionSchema);
    expect(format.type).toBe('json_schema');
    const schema = format.schema as { additionalProperties?: boolean; required?: string[]; properties: Record<string, unknown> };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required?.sort()).toEqual(['documentDate', 'documentType', 'findings', 'issuer', 'language', 'summary']);
    expect(JSON.stringify(schema)).toContain('"other"');
  });
});
