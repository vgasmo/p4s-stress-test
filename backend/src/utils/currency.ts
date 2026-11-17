// Formatação pt-PT com separador de milhares «.» e decimal «,» (ex.: 1.450.000 €).
// Não usa Intl.NumberFormat('pt-PT') porque o CLDR agrupa com espaço e não agrupa
// números de 4 dígitos, o que não corresponde à convenção pedida.
// Sem dependências de Node: também é usado pelo frontend.

const NBSP = ' ';

export function formatNumberPt(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  const negative = value < 0;
  const [intPart = '0', fraction] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const isZero = Number(`${intPart}.${fraction ?? '0'}`) === 0;
  return `${negative && !isZero ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

export function formatEUR(value: number, decimals = 0): string {
  return `${formatNumberPt(value, decimals)}${NBSP}€`;
}

export function formatPercent(value: number, decimals = 0): string {
  return `${formatNumberPt(value, decimals)}%`;
}

/** Converte euros (até 2 casas decimais) para cêntimos inteiros. */
export function toCents(euros: number): bigint {
  return BigInt(Math.round(euros * 100));
}

/** Divisão inteira com arredondamento meio-para-cima. Requer num >= 0 e den > 0. */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('Denominador tem de ser positivo.');
  if (num < 0n) throw new RangeError('Numerador tem de ser não negativo.');
  return (num * 2n + den) / (2n * den);
}
