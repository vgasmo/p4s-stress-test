/** NIF português: 9 dígitos com dígito de controlo módulo 11. */
export function isValidNif(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
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
