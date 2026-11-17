import { describe, expect, it } from 'vitest';
import type { RequirementEvidence } from '@engine/models/api.types';
import {
  clipQuote,
  countsLabel,
  deadlineLabel,
  deadlineShort,
  documentOrigin,
  evidenceByRequirement,
  evidenceHeadline,
  evidenceSource,
  fileProblem,
  formatFileSize,
  requirementLabel,
} from './documents';

const LIMITS = { maxBytes: 10 * 1024 * 1024, acceptedExtensions: ['.pdf', '.docx', '.txt', '.md'] };

const evidence = (overrides: Partial<RequirementEvidence>): RequirementEvidence => ({
  findingId: 'f1',
  analysisId: 'a1',
  requirementCode: 'ecovadis',
  topic: 'EcoVadis',
  request: 'Ter avaliação EcoVadis.',
  obligation: 'mandatory',
  deadline: '2027-06-30',
  deadlineText: null,
  consequence: null,
  quote: 'Suppliers must hold a valid EcoVadis assessment.',
  quotePage: 1,
  fileName: 'questionario.pdf',
  issuer: 'Nordwerk GmbH',
  documentDate: '2026-09-15',
  ...overrides,
});

describe('ficheiro escolhido', () => {
  it('aceita os formatos lidos, sem olhar a maiúsculas', () => {
    expect(fileProblem({ name: 'Questionário.PDF', size: 1000 }, LIMITS)).toBeNull();
    expect(fileProblem({ name: 'carta.docx', size: 1000 }, LIMITS)).toBeNull();
    expect(fileProblem({ name: 'notas.txt', size: 1000 }, LIMITS)).toBeNull();
    // Sem extensão segue: o servidor identifica o formato pelo conteúdo.
    expect(fileProblem({ name: 'documento', size: 1000 }, LIMITS)).toBeNull();
  });

  it('explica o que fazer com Excel e com o Word antigo', () => {
    expect(fileProblem({ name: 'questionario.xlsx', size: 1000 }, LIMITS)).toMatch(/Exporte a folha para PDF/);
    expect(fileProblem({ name: 'questionario.XLS', size: 1000 }, LIMITS)).toMatch(/Exporte a folha para PDF/);
    expect(fileProblem({ name: 'carta.doc', size: 1000 }, LIMITS)).toMatch(/\.docx ou PDF/);
  });

  it('recusa formatos desconhecidos, ficheiros vazios e grandes demais', () => {
    expect(fileProblem({ name: 'foto.png', size: 1000 }, LIMITS)).toBe('Formato não suportado (.png). São aceites .pdf, .docx, .txt, .md.');
    expect(fileProblem({ name: 'vazio.pdf', size: 0 }, LIMITS)).toBe('O ficheiro está vazio.');
    expect(fileProblem({ name: 'enorme.pdf', size: 12 * 1024 * 1024 }, LIMITS)).toBe('O ficheiro tem 12 MB e o máximo é 10 MB.');
  });

  it('tamanhos em unidades que se leem', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(4958)).toBe('4,8 KB');
    expect(formatFileSize(3.25 * 1024 * 1024)).toBe('3,3 MB');
  });
});

describe('textos da análise', () => {
  it('o prazo mostra a data, o texto do documento, ou os dois', () => {
    expect(deadlineLabel({ deadline: '2027-06-30', deadlineText: null })).toBe('30/06/2027');
    expect(deadlineLabel({ deadline: null, deadlineText: 'within 90 days' })).toBe('«within 90 days»');
    expect(deadlineLabel({ deadline: '2027-06-30', deadlineText: 'no later than 30 June 2027' })).toBe(
      '30/06/2027 («no later than 30 June 2027»)',
    );
    expect(deadlineLabel({ deadline: null, deadlineText: null })).toBeNull();
    // No plano e no resumo impresso fica só a data, quando existe.
    expect(deadlineShort({ deadline: '2027-06-30', deadlineText: 'no later than 30 June 2027' })).toBe('30/06/2027');
    expect(deadlineShort({ deadline: null, deadlineText: 'within 90 days' })).toBe('«within 90 days»');
    expect(deadlineShort({ deadline: null, deadlineText: null })).toBeNull();
  });

  it('o resumo das contagens só fala do que existe', () => {
    expect(countsLabel({ total: 0, pending: 0, confirmed: 0, rejected: 0, unverified: 0 })).toBe('Sem exigências ao fornecedor');
    expect(countsLabel({ total: 1, pending: 1, confirmed: 0, rejected: 0, unverified: 0 })).toBe('1 exigência · 1 por rever');
    expect(countsLabel({ total: 6, pending: 2, confirmed: 3, rejected: 1, unverified: 1 })).toBe(
      '6 exigências · 3 confirmadas · 2 por rever · 1 rejeitada',
    );
  });

  it('a origem do documento junta o que se sabe', () => {
    expect(documentOrigin({ issuer: 'Nordwerk GmbH', documentType: 'Questionário', documentDate: '2026-09-15' })).toBe(
      'Nordwerk GmbH · Questionário · 15/09/2026',
    );
    expect(documentOrigin({ issuer: null, documentType: 'Carta', documentDate: null })).toBe('Carta');
    expect(documentOrigin({ issuer: null, documentType: null, documentDate: null })).toBeNull();
  });

  it('o requisito sem código tem nome próprio', () => {
    expect(requirementLabel('ecovadis')).toBe('EcoVadis');
    expect(requirementLabel(null)).toBe('Fora dos requisitos do stress test');
  });
});

describe('evidência no plano', () => {
  it('agrupa por requisito, mantendo a ordem recebida', () => {
    const grouped = evidenceByRequirement([
      evidence({ findingId: 'a' }),
      evidence({ findingId: 'b', requirementCode: 'carbon_scope_1_2' }),
      evidence({ findingId: 'c' }),
    ]);
    expect(grouped.get('ecovadis')?.map((item) => item.findingId)).toEqual(['a', 'c']);
    expect(grouped.get('carbon_scope_1_2')).toHaveLength(1);
    expect(grouped.get('banking_esg')).toBeUndefined();
  });

  it('o título diz quem pede e o prazo mais próximo', () => {
    expect(evidenceHeadline([evidence({})])).toBe('Exigido por escrito por Nordwerk GmbH, até 30/06/2027');
    expect(
      evidenceHeadline([evidence({ deadline: '2027-06-30' }), evidence({ issuer: 'Banco Exemplo', deadline: '2027-01-15' }), evidence({ deadline: null })]),
    ).toBe('Exigido por escrito por Nordwerk GmbH e Banco Exemplo, até 15/01/2027');
    expect(evidenceHeadline([evidence({ issuer: 'A' }), evidence({ issuer: 'B' }), evidence({ issuer: 'C', deadline: null })])).toBe(
      'Exigido por escrito por 3 entidades, até 30/06/2027',
    );
    expect(evidenceHeadline([evidence({ issuer: null, deadline: null })])).toBe('Exigido por escrito');
  });

  it('a fonte junta emitente, ficheiro e página, sem inventar a página', () => {
    expect(evidenceSource(evidence({}))).toBe('Nordwerk GmbH, questionario.pdf, p. 1');
    expect(evidenceSource(evidence({ issuer: null, quotePage: null }))).toBe('questionario.pdf');
  });

  it('uma citação longa é cortada numa palavra, com o corte à vista', () => {
    const quote = 'Suppliers must hold a valid EcoVadis assessment with a minimum overall score of 55 points no later than 30 June 2027.';
    expect(clipQuote(quote, 200)).toBe(quote);
    const clipped = clipQuote(quote, 60);
    expect(clipped).toBe('Suppliers must hold a valid EcoVadis assessment with a…');
    expect(clipped.length).toBeLessThanOrEqual(60);
    expect(clipQuote('  duas\n linhas  ', 50)).toBe('duas linhas');
    expect(clipQuote('a'.repeat(100), 20)).toBe(`${'a'.repeat(19)}…`);
  });
});
