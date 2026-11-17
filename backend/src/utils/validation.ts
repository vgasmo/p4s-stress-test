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

/** CAE (Rev. 3/Rev. 4): subclasse de 5 dígitos. */
export function isValidCae(value: string): boolean {
  return /^\d{5}$/.test(value);
}

/** Caracteres de controlo, que a base de dados recusa (NUL) ou que estragam o que se imprime. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LINE_BREAKS = /[\t\n\r]/;

/** Texto de uma só linha (nomes, títulos): sem caracteres de controlo nem quebras de linha. */
export function isSingleLineText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value) && !LINE_BREAKS.test(value);
}

/** Texto corrido (descrições): aceita quebras de linha, mas não outros caracteres de controlo. */
export function isPlainText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value);
}
