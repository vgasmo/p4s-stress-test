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

/** Arredonda a N algarismos significativos (2.827.500 → 2.800.000). */
export function roundToSignificant(value: number, digits = 2): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (magnitude - digits + 1);
  return Math.round(value / factor) * factor;
}

/**
 * Ordem de grandeza em euros, com 2 algarismos significativos: «2,8 M €», «780 mil €»,
 * «9.400 €». Para valores que são estimativas e não devem parecer exatos ao euro.
 */
export function formatMagnitudeEUR(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = roundToSignificant(Math.max(0, value), 2);
  const scaled = (divisor: number) => {
    const units = Math.round((rounded / divisor) * 10) / 10;
    return formatNumberPt(units, Number.isInteger(units) ? 0 : 1);
  };
  if (rounded >= 1_000_000_000) return `${scaled(1_000_000_000)}${NBSP}mil${NBSP}M${NBSP}€`;
  if (rounded >= 1_000_000) return `${scaled(1_000_000)}${NBSP}M${NBSP}€`;
  if (rounded >= 10_000) return `${scaled(1_000)}${NBSP}mil${NBSP}€`;
  return formatEUR(rounded);
}

/** «≈ 2,8 M €». Zero fica «0 €», sem sinal de aproximação. */
export function formatApproxEUR(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value > 0 ? `≈${NBSP}${formatMagnitudeEUR(value)}` : formatEUR(0);
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
