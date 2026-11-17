import { describe, expect, it } from 'vitest';
import { MIN_QUOTE_SIGNS, createQuoteVerifier, quoteFingerprint } from '../../src/services/quote-verifier.js';

const PAGES = [
  'Supplier requirements\n2.1 Suppliers must hold a valid EcoVadis assess-\nment with a minimum overall score of 55 points.',
  '3.1 Suppliers shall report their Scope 1 and Scope 2 emissions “in accordance with the GHG Protocol” by 31 March.\nThe ﬁrst report is due in 2027 and covers the previous',
  'calendar year. Late reports are not accepted.',
];

describe('verificação das citações', () => {
  const verify = createQuoteVerifier(PAGES);

  it('encontra a citação e diz em que página está, seja qual for a página que a IA indicou', () => {
    expect(verify('Suppliers shall report their Scope 1 and Scope 2 emissions', 1)).toEqual({ verified: true, page: 2 });
    expect(verify('Suppliers shall report their Scope 1 and Scope 2 emissions', null)).toEqual({ verified: true, page: 2 });
    expect(verify('Suppliers shall report their Scope 1 and Scope 2 emissions', 99)).toEqual({ verified: true, page: 2 });
  });

  it('ignora o que muda entre o PDF e a cópia: linhas, hifenização, aspas, ligaduras e maiúsculas', () => {
    expect(verify('Suppliers must hold a valid EcoVadis assessment with a minimum overall score of 55 points.')).toEqual({
      verified: true,
      page: 1,
    });
    expect(verify('emissions "in accordance with the GHG Protocol" by 31 March')).toEqual({ verified: true, page: 2 });
    expect(verify('The first report is due in 2027')).toEqual({ verified: true, page: 2 });
    expect(verify('SUPPLIERS MUST HOLD A VALID ECOVADIS')).toEqual({ verified: true, page: 1 });
  });

  it('aceita uma citação que atravessa a mudança de página e atribui-a à página onde começa', () => {
    expect(verify('covers the previous calendar year. Late reports are not accepted.')).toEqual({ verified: true, page: 2 });
  });

  it('recusa o que não está no documento: palavras trocadas, números diferentes, frases com cortes ou inventadas', () => {
    expect(verify('Suppliers must hold a valid EcoVadis assessment with a minimum overall score of 65 points.').verified).toBe(false);
    expect(verify('Suppliers should hold a valid EcoVadis assessment').verified).toBe(false);
    expect(verify('Suppliers must hold a valid EcoVadis assessment [...] of 55 points.').verified).toBe(false);
    expect(verify('Suppliers must hold a valid EcoVadis assessment ... Late reports are not accepted.').verified).toBe(false);
    expect(verify('Suppliers must be certified to ISO 14001 by 2027.')).toEqual({ verified: false, page: null });
  });

  it('não junta páginas que não são seguidas', () => {
    expect(verify('a minimum overall score of 55 points. calendar year.').verified).toBe(false);
  });

  it('recusa citações curtas demais para provar alguma coisa', () => {
    expect(verify('55 points').verified).toBe(false);
    expect(verify('').verified).toBe(false);
    expect(verify('   \n ').verified).toBe(false);
    expect(quoteFingerprint('Late reports').length).toBeLessThan(MIN_QUOTE_SIGNS);
    expect(verify('Late reports are not').verified).toBe(true);
  });

  it('um documento sem texto não verifica nada', () => {
    expect(createQuoteVerifier([])('Suppliers must hold a valid EcoVadis assessment').verified).toBe(false);
    expect(createQuoteVerifier([''])('Suppliers must hold a valid EcoVadis assessment').verified).toBe(false);
  });
});
