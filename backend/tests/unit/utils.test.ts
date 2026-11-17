import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, formatEUR, formatNumberPt, formatPercent } from '../../src/utils/currency.js';
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
