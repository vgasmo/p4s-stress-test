/**
 * NIF português: 9 dígitos com dígito de controlo módulo 11. O primeiro dígito identifica o
 * tipo de contribuinte: 0 não existe e 4 só é usado no prefixo 45 (não residentes).
 */
export function isValidNif(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  if (value.startsWith('0') || (value.startsWith('4') && !value.startsWith('45'))) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 8).reduce((acc, digit, index) => acc + digit * (9 - index), 0);
  const remainder = sum % 11;
  const check = remainder < 2 ? 0 : 11 - remainder;
  return check === digits[8];
}

/** NIF com dígito de controlo válido a partir dos 8 primeiros dígitos (dados de demonstração e testes). */
export function nifWithCheckDigit(prefix: string): string {
  if (!/^\d{8}$/.test(prefix)) throw new RangeError('O prefixo do NIF tem de ter 8 dígitos.');
  const remainder = [...prefix].reduce((acc, digit, index) => acc + Number(digit) * (9 - index), 0) % 11;
  return `${prefix}${remainder < 2 ? 0 : 11 - remainder}`;
}

/** CAE (Rev. 3/Rev. 4): subclasse de 5 dígitos. */
export function isValidCae(value: string): boolean {
  return /^\d{5}$/.test(value);
}

/**
 * Caracteres de controlo, que a base de dados recusa (NUL) ou que estragam o que se imprime,
 * incluindo as marcas que invertem a direção do texto.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
/** Inclui os separadores de linha e de parágrafo do Unicode, que partem um título em duas linhas. */
const LINE_BREAKS = /[\t\n\r\u2028\u2029]/;

/** Texto de uma só linha (nomes, títulos): sem caracteres de controlo nem quebras de linha. */
export function isSingleLineText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value) && !LINE_BREAKS.test(value);
}

/** Texto corrido (descrições): aceita quebras de linha, mas não outros caracteres de controlo. */
export function isPlainText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value);
}
