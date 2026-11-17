// Verificação das citações: uma exigência extraída pela IA só vale se a frase que a sustenta
// existir mesmo no documento. Esta verificação é feita pelo servidor, sobre o texto que o
// servidor extraiu, e não depende do que a IA diz sobre si própria.
// Sem dependências de Node nem de rede: funções puras.

/** Abaixo disto uma citação é curta demais para provar alguma coisa («sim», «2025»). */
export const MIN_QUOTE_SIGNS = 12;

/**
 * Reduz um texto ao que tem de coincidir. Fica de fora o que muda entre o PDF e a cópia sem
 * mudar o conteúdo: quebras de linha e espaços, hifenização no fim da linha, ligaduras («ﬁ»),
 * aspas e travessões tipográficos, maiúsculas. As letras, os números e a ordem não mudam.
 */
export function quoteFingerprint(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟«»″]/g, '"')
    .replace(/\s+/g, '')
    .replace(/[-‐-―−]/g, '')
    .toLowerCase();
}

export interface QuoteMatch {
  verified: boolean;
  /** Página (a contar de 1) onde a citação começa. Null se não foi encontrada. */
  page: number | null;
}

const NOT_FOUND: QuoteMatch = { verified: false, page: null };

/**
 * Prepara as páginas uma vez e devolve a função que procura cada citação. A página indicada
 * pela IA só serve para procurar primeiro aí: o que conta é onde o servidor encontra o texto.
 * Uma citação que atravessa a mudança de página conta para a página onde começa.
 */
export function createQuoteVerifier(pages: readonly string[]): (quote: string, claimedPage?: number | null) => QuoteMatch {
  const prints = pages.map(quoteFingerprint);

  return (quote, claimedPage) => {
    const needle = quoteFingerprint(quote);
    if (needle.length < MIN_QUOTE_SIGNS) return NOT_FOUND;

    const claimedIndex =
      typeof claimedPage === 'number' && Number.isInteger(claimedPage) && claimedPage >= 1 && claimedPage <= prints.length
        ? claimedPage - 1
        : -1;
    if (claimedIndex >= 0 && prints[claimedIndex]?.includes(needle)) return { verified: true, page: claimedIndex + 1 };

    for (let index = 0; index < prints.length; index += 1) {
      if (index !== claimedIndex && prints[index]?.includes(needle)) return { verified: true, page: index + 1 };
    }
    for (let index = 0; index + 1 < prints.length; index += 1) {
      if (`${prints[index] ?? ''}${prints[index + 1] ?? ''}`.includes(needle)) return { verified: true, page: index + 1 };
    }
    return NOT_FOUND;
  };
}
