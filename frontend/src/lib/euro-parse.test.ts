import { describe, expect, it } from 'vitest';
import { parseEuroInput } from './euro-parse';

const NBSP = ' ';
const value = (text: string, decimals = 0) => {
  const parsed = parseEuroInput(text, { decimals });
  return parsed.ok ? parsed.value : parsed.reason;
};
/** Motivo da recusa e se a entrada ainda pode ficar válida com mais caracteres. */
const refusal = (text: string) => {
  const parsed = parseEuroInput(text);
  return parsed.ok ? `aceite: ${parsed.value}` : `${parsed.reason}${parsed.partial ? ' (a meio)' : ''}`;
};

describe('notação dos botões rápidos e do painel', () => {
  it.each([
    ['5M', 5_000_000],
    ['6,5M', 6_500_000],
    ['6,5 M', 6_500_000],
    ['6500k', 6_500_000],
    ['500k', 500_000],
    ['500 mil', 500_000],
    ['2M €', 2_000_000],
    ['2,5M €', 2_500_000],
    [`≈${NBSP}2,8${NBSP}M${NBSP}€`, 2_800_000],
    [`780${NBSP}mil${NBSP}€`, 780_000],
    ['1,2 mil M €', 1_200_000_000],
    ['5 milhões', 5_000_000],
    ['1 milhão', 1_000_000],
    ['2,5 milhoes de euros', 2_500_000],
    ['3 mil milhões', 3_000_000_000],
    ['6,500M', 6_500_000],
  ])('«%s» são %d €', (text, expected) => {
    expect(value(text)).toBe(expected);
  });

  it('não distingue maiúsculas de minúsculas', () => {
    expect(value('5m')).toBe(5_000_000);
    expect(value('500K')).toBe(500_000);
    expect(value('500 MIL')).toBe(500_000);
    expect(value('2 MILHÕES')).toBe(2_000_000);
  });

  it('faz as contas sobre os algarismos escritos, sem erros de vírgula flutuante', () => {
    expect(value('0,07M')).toBe(70_000);
    expect(value('0,29M')).toBe(290_000);
    expect(value('1,005k', 2)).toBe(1005);
    expect(value('4,35 mil', 2)).toBe(4350);
  });
});

describe('escrita portuguesa', () => {
  it.each([
    ['1.450.000', 1_450_000],
    ['1450000', 1_450_000],
    ['1.450', 1450],
    ['6 500 000', 6_500_000],
    [`6${NBSP}500${NBSP}000`, 6_500_000],
    ['0', 0],
    ['007', 7],
    ['6,', 6],
  ])('«%s» são %d €', (text, expected) => {
    expect(value(text)).toBe(expected);
  });

  it('os cêntimos são arredondados às casas que o campo guarda', () => {
    expect(value('1,5')).toBe(2);
    expect(value('1,4')).toBe(1);
    expect(value('1450000,50')).toBe(1_450_001);
    expect(value('1.450.000,50', 2)).toBe(1_450_000.5);
    expect(value('1,5', 2)).toBe(1.5);
    expect(value('0,05', 1)).toBe(0.1);
    expect(value('0,04', 1)).toBe(0);
  });

  it('aceita espaços à volta e o símbolo do euro antes ou depois', () => {
    expect(value('  6.500.000  ')).toBe(6_500_000);
    expect(value('6.500.000 €')).toBe(6_500_000);
    expect(value(`6.500.000${NBSP}€`)).toBe(6_500_000);
    expect(value('€ 6.500.000')).toBe(6_500_000);
    expect(value('6500000€')).toBe(6_500_000);
    expect(value('5M€')).toBe(5_000_000);
    expect(value('5 M €')).toBe(5_000_000);
    expect(value('500 mil euros')).toBe(500_000);
    expect(value('6500000 EUR')).toBe(6_500_000);
    expect(value('+5000')).toBe(5000);
  });

  it('campo vazio é zero', () => {
    expect(parseEuroInput('')).toEqual({ ok: true, value: 0 });
    expect(parseEuroInput('   ')).toEqual({ ok: true, value: 0 });
  });
});

describe('o que não percebe é recusado, nunca adivinhado', () => {
  it('um ponto que não separa milhares não é lido como decimal', () => {
    expect(refusal('6500000.50')).toBe('separators');
    expect(refusal('2.5M')).toBe('separators');
    expect(refusal('1.4500')).toBe('separators');
    expect(refusal('1.450.00.0')).toBe('separators');
  });

  it('um número com milhares não começa por zero', () => {
    expect(refusal('0.500')).toBe('separators');
    expect(refusal('0.5')).toBe('separators');
    expect(refusal('0.5M')).toBe('separators');
    expect(refusal('012.345')).toBe('separators');
    expect(refusal('0 500')).toBe('separators');
    expect(value('0,5M')).toBe(500_000);
    expect(value('0500')).toBe(500);
  });

  it('vírgulas à inglesa também não', () => {
    expect(refusal('1,450,000')).toBe('separators');
    expect(refusal('6,500 €')).toBe('separators');
    expect(refusal('1.450 000')).toBe('separators');
    expect(refusal('65 00000')).toBe('separators');
  });

  it('texto que não é um valor', () => {
    expect(refusal('abc')).toBe('unrecognized');
    expect(refusal('5x')).toBe('unrecognized');
    expect(refusal('M')).toBe('unrecognized');
    expect(refusal('mil')).toBe('unrecognized');
    expect(refusal('5MM')).toBe('unrecognized');
    expect(refusal('5m3')).toBe('unrecognized');
    expect(refusal('€5€x')).toBe('unrecognized');
    expect(refusal('cinco milhões')).toBe('unrecognized');
  });

  it('valores negativos', () => {
    expect(refusal('-5000')).toBe('negative');
    expect(refusal('−5000')).toBe('negative');
    expect(refusal('- 5M')).toBe('negative');
    expect(refusal('-')).toBe('negative');
    expect(refusal('-2.5')).toBe('negative');
    expect(refusal('-abc')).toBe('unrecognized');
  });

  it('acima do máximo', () => {
    expect(value('999.999.999.999')).toBe(999_999_999_999);
    expect(refusal('1.000.000.000.000')).toBe('too_large');
    expect(refusal('99999999999999')).toBe('too_large');
    expect(refusal('1000 mil M')).toBe('too_large');
    expect(refusal('9'.repeat(400))).toBe('too_large');
    expect(parseEuroInput('100.000.000', { max: 99_999_999.99 })).toMatchObject({ ok: false, reason: 'too_large' });
    expect(parseEuroInput('99.999.999', { max: 99_999_999.99 })).toEqual({ ok: true, value: 99_999_999 });
  });

  it('cada recusa traz uma frase para mostrar junto ao campo', () => {
    const message = (text: string, options = {}) => {
      const parsed = parseEuroInput(text, options);
      return parsed.ok ? null : parsed.message;
    };
    expect(message('2.5M')).toBe('Use ponto só nos milhares e vírgula nos cêntimos.');
    expect(message('abc')).toBe('Não é um valor em euros. Pode escrever 6.500.000, 6,5M ou 500 mil.');
    expect(message('-1')).toBe('O valor não pode ser negativo.');
    expect(message('99999999999999')).toBe(`O máximo é 999.999.999.999${NBSP}€.`);
    expect(message('100.000.000,00', { max: 99_999_999.99, decimals: 2 })).toBe(`O máximo é 99.999.999,99${NBSP}€.`);
  });
});

describe('entrada a meio de ser escrita', () => {
  it('milhares por acabar ainda podem ficar válidos', () => {
    expect(refusal('1.')).toBe('separators (a meio)');
    expect(refusal('1.4')).toBe('separators (a meio)');
    expect(refusal('2.5')).toBe('separators (a meio)');
    expect(refusal('1.450.')).toBe('separators (a meio)');
    expect(refusal('1.450.00')).toBe('separators (a meio)');
    expect(refusal('6 50')).toBe('separators (a meio)');
    expect(refusal('1.450.000')).toBe('aceite: 1450000');
  });

  it('multiplicador ou moeda por acabar', () => {
    expect(refusal('5 mi')).toBe('unrecognized (a meio)');
    expect(refusal('5 milh')).toBe('unrecognized (a meio)');
    expect(refusal('5 milhões d')).toBe('unrecognized (a meio)');
    expect(refusal('500 e')).toBe('unrecognized (a meio)');
    expect(refusal('€')).toBe('unrecognized (a meio)');
    expect(refusal('6,500')).toBe('separators (a meio)');
  });

  it('o que já não tem conserto é recusado logo', () => {
    expect(refusal('6500000.')).toBe('separators');
    expect(refusal('1.5m')).toBe('separators');
    expect(refusal('1.45 mi')).toBe('separators');
    expect(refusal('5 mx')).toBe('unrecognized');
  });
});
