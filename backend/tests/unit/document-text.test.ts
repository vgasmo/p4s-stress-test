import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_CHARS, extractDocumentText } from '../../src/services/document-text.js';

const example = (name: string) => readFileSync(path.resolve('..', 'exemplos', name));
const fixture = (name: string) => readFileSync(path.resolve('tests', 'fixtures', name));
const LONG_ENOUGH = 'O fornecedor deve apresentar a pegada de carbono dos âmbitos 1 e 2 até 31 de março de cada ano. '.repeat(4);

async function rejection(buffer: Buffer, fileName: string): Promise<{ status: number; code: string; message: string }> {
  try {
    await extractDocumentText(buffer, fileName);
  } catch (error) {
    const { status, code, message } = error as { status: number; code: string; message: string };
    return { status, code, message };
  }
  throw new Error('devia ter sido recusado');
}

describe('extração do texto dos documentos', () => {
  it('lê um PDF página a página', async () => {
    const document = await extractDocumentText(example('questionario-fornecedor-exemplo.pdf'), 'questionario.pdf');
    expect(document.kind).toBe('pdf');
    expect(document.pageCount).toBe(3);
    expect(document.pages).toHaveLength(3);
    expect(document.pages[0]).toContain('minimum overall score of 55 points');
    expect(document.pages[1]).toContain('TISAX label at Assessment Level 2');
    expect(document.pages[2]).toContain('will not be considered for new sourcing decisions');
    expect(document.charCount).toBeGreaterThan(2000);
  });

  it('lê um Word (.docx) como um só bloco, sem páginas', async () => {
    const document = await extractDocumentText(example('carta-banco-exemplo.docx'), 'carta.docx');
    expect(document.kind).toBe('docx');
    expect(document.pageCount).toBeNull();
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]).toContain('questionário ESG do banco preenchido');
  });

  it('identifica o formato pelo conteúdo, e não pela extensão', async () => {
    expect((await extractDocumentText(example('questionario-fornecedor-exemplo.pdf'), 'sem-extensao')).kind).toBe('pdf');
    expect((await extractDocumentText(example('carta-banco-exemplo.docx'), 'carta.pdf')).kind).toBe('docx');
    expect((await extractDocumentText(Buffer.from(LONG_ENOUGH), 'notas.pdf')).kind).toBe('txt');
  });

  it('lê texto simples em UTF-8 e no formato antigo do Windows', async () => {
    const utf8 = await extractDocumentText(Buffer.from(LONG_ENOUGH, 'utf8'), 'notas.txt');
    expect(utf8.pages[0]).toContain('âmbitos 1 e 2 até 31 de março');
    const windows = await extractDocumentText(Buffer.from(LONG_ENOUGH, 'latin1'), 'notas.txt');
    expect(windows.pages[0]).toContain('âmbitos 1 e 2 até 31 de março');
    expect(windows.charCount).toBe(utf8.charCount);
  });

  it('recusa um PDF digitalizado (sem texto) e explica porquê', async () => {
    const error = await rejection(fixture('digitalizado.pdf'), 'digitalizado.pdf');
    expect(error).toMatchObject({ status: 422, code: 'DOCUMENT_WITHOUT_TEXT' });
    expect(error.message).toMatch(/digitalização/);
  });

  it('recusa um PDF protegido por palavra-passe', async () => {
    expect(await rejection(fixture('protegido.pdf'), 'protegido.pdf')).toMatchObject({ status: 422, code: 'DOCUMENT_PROTECTED' });
  });

  it('recusa um PDF estragado sem rebentar', async () => {
    const broken = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(400, 0x41)]);
    expect(await rejection(broken, 'estragado.pdf')).toMatchObject({ status: 422, code: 'DOCUMENT_UNREADABLE' });
  });

  it('recusa formatos que não lê, com a alternativa', async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(300, 1)]);
    const excel = await rejection(zip, 'Questionário.XLSX');
    expect(excel).toMatchObject({ status: 422, code: 'UNSUPPORTED_DOCUMENT' });
    expect(excel.message).toMatch(/Excel.*PDF/);
    expect(await rejection(zip, 'apresentacao.pptx')).toMatchObject({ status: 422, code: 'UNSUPPORTED_DOCUMENT' });
    expect(await rejection(zip, 'arquivo.zip')).toMatchObject({ status: 422, code: 'UNSUPPORTED_DOCUMENT' });

    const oldOffice = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(300, 1)]);
    expect((await rejection(oldOffice, 'carta.doc')).message).toMatch(/\.docx ou PDF/);

    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.alloc(300, 7)]);
    expect(await rejection(image, 'foto.png')).toMatchObject({ status: 422, code: 'UNSUPPORTED_DOCUMENT' });
  });

  it('recusa um ficheiro vazio ou quase sem texto', async () => {
    expect(await rejection(Buffer.alloc(0), 'vazio.txt')).toMatchObject({ status: 422, code: 'EMPTY_DOCUMENT' });
    expect(await rejection(Buffer.from('Só uma linha.'), 'curto.txt')).toMatchObject({ status: 422, code: 'DOCUMENT_WITHOUT_TEXT' });
    expect(await rejection(Buffer.from(' \n'.repeat(500)), 'espacos.txt')).toMatchObject({ status: 422, code: 'DOCUMENT_WITHOUT_TEXT' });
  });

  it('recusa um documento longo demais em vez de o cortar em silêncio', async () => {
    const error = await rejection(Buffer.from('a'.repeat(MAX_DOCUMENT_CHARS + 1)), 'enorme.txt');
    expect(error).toMatchObject({ status: 422, code: 'DOCUMENT_TOO_LONG' });
    expect(error.message).toMatch(/Divida-o/);
    expect((await extractDocumentText(Buffer.from('a'.repeat(MAX_DOCUMENT_CHARS)), 'no-limite.txt')).charCount).toBe(MAX_DOCUMENT_CHARS);
  });
});
