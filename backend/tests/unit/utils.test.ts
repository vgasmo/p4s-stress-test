import { describe, expect, it } from 'vitest';
import {
  divRoundHalfUp,
  formatApproxEUR,
  formatEUR,
  formatMagnitudeEUR,
  formatNumberPt,
  formatPercent,
  roundToSignificant,
} from '../../src/utils/currency.js';
import { addDays, daysBetween, formatDatePt, isValidIsoDate, todayInLisbon } from '../../src/utils/dates.js';
import { isValidCae, isValidNif } from '../../src/utils/validation.js';

const NBSP = ' ';

describe('currency', () => {
  it('formata euros em pt-PT com ponto nos milhares', () => {
    expect(formatEUR(1_450_000)).toBe(`1.450.000${NBSP}€`);
    expect(formatEUR(3_500)).toBe(`3.500${NBSP}€`);
    expect(formatEUR(999)).toBe(`999${NBSP}€`);
    expect(formatEUR(1_234.5, 2)).toBe(`1.234,50${NBSP}€`);
    expect(formatEUR(0)).toBe(`0${NBSP}€`);
  });

  it('formata percentagens e números', () => {
    expect(formatPercent(62)).toBe('62%');
    expect(formatPercent(12.345, 1)).toBe('12,3%');
    expect(formatNumberPt(-1500)).toBe('−1.500');
    expect(formatNumberPt(-0.4)).toBe('0');
    expect(formatNumberPt(Number.NaN)).toBe('—');
  });

  it('arredonda a 2 algarismos significativos', () => {
    expect(roundToSignificant(2_827_500)).toBe(2_800_000);
    expect(roundToSignificant(4_030_000)).toBe(4_000_000);
    expect(roundToSignificant(785_000)).toBe(790_000);
    expect(roundToSignificant(14)).toBe(14);
    expect(roundToSignificant(9)).toBe(9);
    expect(roundToSignificant(0)).toBe(0);
  });

  it('apresenta estimativas como ordem de grandeza', () => {
    expect(formatApproxEUR(2_827_500)).toBe(`≈${NBSP}2,8${NBSP}M${NBSP}€`);
    expect(formatApproxEUR(4_030_000)).toBe(`≈${NBSP}4${NBSP}M${NBSP}€`);
    expect(formatApproxEUR(12_400_000)).toBe(`≈${NBSP}12${NBSP}M${NBSP}€`);
    expect(formatApproxEUR(780_000)).toBe(`≈${NBSP}780${NBSP}mil${NBSP}€`);
    expect(formatApproxEUR(10_000)).toBe(`≈${NBSP}10${NBSP}mil${NBSP}€`);
    expect(formatApproxEUR(9_440)).toBe(`≈${NBSP}9.400${NBSP}€`);
    expect(formatApproxEUR(14)).toBe(`≈${NBSP}14${NBSP}€`);
    expect(formatApproxEUR(2_500_000_000)).toBe(`≈${NBSP}2,5${NBSP}mil${NBSP}M${NBSP}€`);
    expect(formatApproxEUR(0)).toBe(`0${NBSP}€`);
    expect(formatApproxEUR(Number.NaN)).toBe('—');
  });

  it('formata os limites de um escalão sem sinal de aproximação', () => {
    expect(formatMagnitudeEUR(3_224_000)).toBe(`3,2${NBSP}M${NBSP}€`);
    expect(formatMagnitudeEUR(999_999)).toBe(`1${NBSP}M${NBSP}€`);
    expect(formatMagnitudeEUR(7_500)).toBe(`7.500${NBSP}€`);
    expect(formatMagnitudeEUR(0)).toBe(`0${NBSP}€`);
  });

  it('divide com arredondamento meio-para-cima', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(1n, 3n)).toBe(0n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe('dates', () => {
  it('valida datas ISO', () => {
    expect(isValidIsoDate('2026-11-17')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-11-17T00:00:00Z')).toBe(false);
  });

  it('usa o dia de Lisboa (hora de verão incluída)', () => {
    expect(todayInLisbon(new Date('2026-11-17T23:30:00Z'))).toBe('2026-11-17');
    expect(todayInLisbon(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
  });

  it('soma e subtrai dias de calendário', () => {
    expect(addDays('2026-11-17', 45)).toBe('2027-01-01');
    expect(daysBetween('2026-11-17', '2027-02-15')).toBe(90);
    expect(formatDatePt('2027-01-16')).toBe('16/01/2027');
    expect(formatDatePt(null)).toBe('—');
  });
});

describe('validation', () => {
  it('valida NIF pelo dígito de controlo', () => {
    expect(isValidNif('500000000')).toBe(true);
    expect(isValidNif('510000002')).toBe(true);
    expect(isValidNif('500000001')).toBe(false);
    expect(isValidNif('12345678')).toBe(false);
  });

  it('valida CAE de 5 dígitos', () => {
    expect(isValidCae('25734')).toBe(true);
    expect(isValidCae('2573')).toBe(false);
  });
});
