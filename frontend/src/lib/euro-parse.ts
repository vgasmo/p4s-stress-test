// Leitura de um valor em euros escrito à mão.
//
// Aceita a escrita portuguesa (ponto nos milhares, vírgula nos cêntimos) e a notação dos
// botões rápidos e do painel de impacto: «5M», «6,5 M €», «500k», «500 mil», «1,2 mil M».
// O que não percebe nunca vira zero nem é adivinhado: devolve o motivo, para o campo
// assinalar a entrada e manter o valor anterior. Um ponto que não separa grupos de três
// algarismos («2.5», «6500000.50») tanto pode ser um decimal à inglesa como um engano,
// por isso é recusado em vez de interpretado.
// Funções puras, sem React, para se poderem testar.

import { MAX_MONEY_AMOUNT } from '@engine/services/stress-test-calculator.service';
import { formatEUR } from '@engine/utils/currency';

export type EuroParseFailure = 'unrecognized' | 'separators' | 'negative' | 'too_large';

export type EuroParse =
  | { ok: true; value: number }
  | {
      ok: false;
      reason: EuroParseFailure;
      /** Frase curta para mostrar junto ao campo. */
      message: string;
      /** Ainda pode ficar válida com mais caracteres («1.4» a caminho de «1.450», «5 mi» de «5 mil»). */
      partial: boolean;
    };

export interface EuroParseOptions {
  /** Casas decimais que o campo guarda e mostra. O valor lido é arredondado a estas casas. */
  decimals?: number;
  /** Valor máximo aceite. Por omissão, o teto do motor de cálculo e da API. */
  max?: number;
}

/** Multiplicadores (expoente de 10), em minúsculas e sem espaços. «M» é milhões, como nos botões. */
const UNIT_EXPONENTS: readonly (readonly [string, number])[] = [
  ['k', 3],
  ['mil', 3],
  ['m', 6],
  ['milhão', 6],
  ['milhao', 6],
  ['milhões', 6],
  ['milhoes', 6],
  ['milm', 9],
  ['milmilhões', 9],
  ['milmilhoes', 9],
];
const CURRENCY_WORDS = ['€', 'eur', 'euro', 'euros'];

/** O que pode vir depois do número («m», «mil€», «milhões de euros»), com o expoente que lhe corresponde. */
const TAILS = new Map<string, number>(
  [['', 0] as const, ...UNIT_EXPONENTS].flatMap(([unit, exponent]) =>
    ['', ...CURRENCY_WORDS, ...(unit.includes('milh') ? ['deeuros'] : [])].map(
      (currency) => [`${unit}${currency}`, exponent] as const,
    ),
  ),
);

/**
 * Algarismos seguidos, ou grupos de três separados por ponto ou por espaço, e vírgula decimal.
 * Um número com milhares não começa por zero: «0.500» é um decimal à inglesa, não quinhentos.
 */
const NUMBER = /^(\d+|[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{0,2}(?: \d{3})+)(?:,(\d*))?$/;
/** Número com o último grupo de milhares ainda por acabar de escrever. */
const GROUP_IN_PROGRESS = /^[1-9]\d{0,2}(?:(?:\.\d{3})*\.\d{0,2}|(?: \d{3})* \d{1,2})$/;

const MESSAGES: Record<Exclude<EuroParseFailure, 'too_large'>, string> = {
  unrecognized: 'Não é um valor em euros. Pode escrever 6.500.000, 6,5M ou 500 mil.',
  separators: 'Use ponto só nos milhares e vírgula nos cêntimos.',
  negative: 'O valor não pode ser negativo.',
};

const fail = (reason: Exclude<EuroParseFailure, 'too_large'>, partial = false): EuroParse => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
  partial,
});

/**
 * Valor de «algarismos × 10^expoente», arredondado às casas pedidas (meio para cima). As contas
 * são feitas sobre os algarismos escritos, e não em vírgula flutuante, para «0,07M» dar 70.000.
 */
function scale(digits: string, exponent: number, decimals: number): number {
  const shift = exponent + decimals;
  if (shift >= 0) return Number(digits + '0'.repeat(shift)) / 10 ** decimals;
  const cut = -shift;
  const kept = cut < digits.length ? digits.slice(0, digits.length - cut) : '0';
  const firstDropped = cut <= digits.length ? digits.charAt(digits.length - cut) : '0';
  return (Number(kept) + (firstDropped >= '5' ? 1 : 0)) / 10 ** decimals;
}

/** Lê o que foi escrito num campo em euros. Vazio é zero: quem apaga o campo ainda não escreveu nada. */
export function parseEuroInput(text: string, options: EuroParseOptions = {}): EuroParse {
  const { decimals = 0, max = MAX_MONEY_AMOUNT } = options;
  const clean = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (clean === '') return { ok: true, value: 0 };

  const negative = /^[-−–]/.test(clean);
  const unsigned = clean.replace(/^[-−–+≈~] ?/, '').replace(/^€ ?/, '');
  const parsed = parseUnsigned(unsigned, decimals, max);
  // Um valor negativo nunca fica válido, escreva-se o que se escrever a seguir.
  if (negative) return parsed.ok || parsed.partial ? fail('negative') : { ...parsed, partial: false };
  return parsed;
}

function parseUnsigned(text: string, decimals: number, max: number): EuroParse {
  const [, rawHead = '', rawTail = ''] = /^([\d., ]*)(.*)$/.exec(text) ?? [];
  const head = rawHead.trim();
  const tail = rawTail.replace(/ /g, '');

  const exponent = TAILS.get(tail);
  const tailInProgress = exponent === undefined && [...TAILS.keys()].some((known) => known.startsWith(tail));
  if (exponent === undefined && !tailInProgress) return fail('unrecognized');
  // Só o símbolo do euro, ainda sem número.
  if (head === '') return fail('unrecognized', tail === '');

  const number = NUMBER.exec(head);
  if (!number) return fail('separators', tail === '' && GROUP_IN_PROGRESS.test(head));
  if (exponent === undefined) return fail('unrecognized', true);

  const integerDigits = (number[1] ?? '').replace(/[. ]/g, '');
  const decimalDigits = number[2] ?? '';
  // Sem multiplicador, três casas depois da vírgula («6,500») são milhares escritos à inglesa.
  // Ainda pode ficar válido com um multiplicador («6,500M»).
  if (exponent === 0 && decimalDigits.length > 2) return fail('separators', tail === '');

  const value = scale(integerDigits + decimalDigits, exponent - decimalDigits.length, decimals);
  if (value > max) {
    const shown = Math.floor(max * 10 ** decimals) / 10 ** decimals;
    return { ok: false, reason: 'too_large', message: `O máximo é ${formatEUR(shown, decimals)}.`, partial: false };
  }
  return { ok: true, value };
}
