import { describe, expect, it } from 'vitest';
import { formatBasisPoints, formatShareOfRisk } from './formatters';

describe('formatShareOfRisk', () => {
  it('um custo que existe nunca aparece como «0,0%», por muito grande que seja o risco', () => {
    // A percentagem chega arredondada a duas casas: 14.200 € face a 600 M€ dá 0.
    expect(formatShareOfRisk(0, true)).toBe('<0,1%');
    expect(formatShareOfRisk(0.04, true)).toBe('<0,1%');
    expect(formatShareOfRisk(0.04)).toBe('<0,1%');
  });

  it('sem custo, é mesmo zero', () => {
    expect(formatShareOfRisk(0)).toBe('0,0%');
    expect(formatShareOfRisk(0, false)).toBe('0,0%');
  });

  it('a partir de 0,1% mostra o valor com uma casa', () => {
    expect(formatShareOfRisk(0.1, true)).toBe('0,1%');
    expect(formatShareOfRisk(0.36, true)).toBe('0,4%');
    expect(formatShareOfRisk(12.5)).toBe('12,5%');
  });
});

describe('formatBasisPoints', () => {
  it('diz os pontos base como um diretor financeiro os diz', () => {
    expect(formatBasisPoints(40)).toBe('0,40%');
    expect(formatBasisPoints(125)).toBe('1,25%');
  });
});
