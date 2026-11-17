// Extração do texto de um documento carregado (PDF, Word .docx ou texto simples).
// O ficheiro só existe em memória enquanto é lido: daqui sai o texto, por página nos PDF.

import path from 'node:path';
import { AppError } from '../utils/errors.js';

export type DocumentKind = 'pdf' | 'docx' | 'txt';

export interface ExtractedDocument {
  kind: DocumentKind;
  /** Texto por página (PDF) ou um só bloco com o documento todo (os outros formatos). */
  pages: string[];
  /** Só os PDF têm páginas. */
  pageCount: number | null;
  charCount: number;
}

/** Tamanho máximo do ficheiro carregado. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/**
 * Texto máximo enviado para análise (cerca de 150 páginas cheias). Acima disto o documento é
 * recusado com uma mensagem clara: nunca é cortado em silêncio, porque uma exigência que
 * ficasse na parte cortada desaparecia sem ninguém dar por isso.
 */
export const MAX_DOCUMENT_CHARS = 300_000;
/** Abaixo disto não há texto que se analise (um PDF digitalizado, uma folha em branco). */
export const MIN_DOCUMENT_CHARS = 200;

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;

const rejected = (code: string, message: string) => new AppError(422, code, message);

const startsWith = (buffer: Buffer, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => buffer[offset + index] === byte);

function looksLikePdf(buffer: Buffer): boolean {
  // Alguns PDF trazem lixo antes do cabeçalho: os leitores aceitam-no no primeiro kilobyte.
  return buffer.subarray(0, 1024).includes('%PDF-');
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

async function readPdf(buffer: Buffer): Promise<string[]> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    // Cópia: o leitor de PDF fica com o bloco de memória que recebe.
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return text;
  } catch (error) {
    const name = (error as { name?: string }).name ?? '';
    if (name === 'PasswordException') {
      throw rejected('DOCUMENT_PROTECTED', 'O PDF está protegido por palavra-passe. Retire a proteção e volte a carregar.');
    }
    throw rejected('DOCUMENT_UNREADABLE', 'Não foi possível ler o PDF. Confirme que o ficheiro abre e volte a carregar.');
  }
}

async function readDocx(buffer: Buffer, fileName: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.xlsx' || extension === '.xlsm') {
    throw rejected(
      'UNSUPPORTED_DOCUMENT',
      'As folhas de Excel ainda não são lidas. Exporte a folha para PDF (Ficheiro > Exportar) e carregue o PDF.',
    );
  }
  if (extension === '.pptx') {
    throw rejected('UNSUPPORTED_DOCUMENT', 'As apresentações ainda não são lidas. Exporte para PDF e carregue o PDF.');
  }
  try {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  } catch {
    throw rejected(
      'UNSUPPORTED_DOCUMENT',
      'O ficheiro não é um documento Word (.docx) que se consiga ler. São aceites PDF, Word (.docx) e texto simples.',
    );
  }
}

function readPlainText(buffer: Buffer): string {
  // Bytes de controlo (fora de tabulação e mudanças de linha) denunciam um ficheiro binário.
  const binary = buffer.some((byte) => byte < 0x09 || (byte > 0x0d && byte < 0x20));
  if (binary) {
    throw rejected('UNSUPPORTED_DOCUMENT', 'Formato não suportado. São aceites PDF, Word (.docx) e texto simples.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Texto gravado no Windows em português, anterior ao UTF-8.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Identifica o formato pelo conteúdo (e não pela extensão) e devolve o texto. */
export async function extractDocumentText(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  if (buffer.length === 0) throw rejected('EMPTY_DOCUMENT', 'O ficheiro está vazio.');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new AppError(413, 'BAD_REQUEST', 'Pedido demasiado grande.');

  let kind: DocumentKind;
  let pages: string[];
  if (looksLikePdf(buffer)) {
    kind = 'pdf';
    pages = await readPdf(buffer);
  } else if (startsWith(buffer, ZIP)) {
    kind = 'docx';
    pages = [await readDocx(buffer, fileName)];
  } else if (startsWith(buffer, OLE)) {
    throw rejected(
      'UNSUPPORTED_DOCUMENT',
      'Os formatos antigos do Office (.doc, .xls) não são lidos. Grave o documento como .docx ou PDF e volte a carregar.',
    );
  } else {
    kind = 'txt';
    pages = [readPlainText(buffer)];
  }

  // U+0000 não se guarda no PostgreSQL e não é texto.
  pages = pages.map((page) => page.replaceAll('\u0000', ''));
  const charCount = pages.reduce((total, page) => total + page.trim().length, 0);

  if (charCount < MIN_DOCUMENT_CHARS) {
    throw rejected(
      'DOCUMENT_WITHOUT_TEXT',
      kind === 'pdf'
        ? 'O PDF quase não tem texto: parece uma digitalização (imagem). Ainda não há reconhecimento de texto em imagens. Peça o documento original ou passe-o por OCR antes de carregar.'
        : 'O documento quase não tem texto para analisar.',
    );
  }
  if (charCount > MAX_DOCUMENT_CHARS) {
    throw rejected(
      'DOCUMENT_TOO_LONG',
      `O documento tem ${charCount.toLocaleString('pt-PT')} caracteres e o máximo por análise é ${MAX_DOCUMENT_CHARS.toLocaleString('pt-PT')}. Divida-o e carregue só as partes com as exigências ao fornecedor.`,
    );
  }

  return { kind, pages, pageCount: kind === 'pdf' ? pages.length : null, charCount };
}
