import { describe, expect, it } from 'vitest';
import type { AssessmentListEntry } from '@engine/models/api.types';
import { answersFromSnapshot, applyPreviousAnswers, differencesFromRecord, latestOpenable } from './previous-answers';
import { DEFAULT_STATE, freshDraft, reconcileDraft, toStressTestInput, type DraftContext } from './wizard-draft';

const entry = (id: string, createdAt: string, openable = true): AssessmentListEntry => ({
  id,
  status: 'completed',
  sectorProfile: 'automotive_molds',
  riskScore: 75,
  commercialRevenueAtRisk: 2_827_500,
  estimatedSpreadPenalty: 10_000,
  taskCount: 3,
  openable,
  proposal: { issuedOn: createdAt.slice(0, 10), validUntil: '2026-12-17', validityDays: 30, expired: false },
  conductedByName: 'Consultora',
  completedAt: createdAt,
  createdAt,
});

/** O que fica gravado em snapshot.input: as respostas de um diagnóstico de moldes com 58%. */
const savedInput = {
  sectorProfile: 'automotive_molds',
  annualRevenue: 6_500_000,
  topClientsShare: 58,
  creditLineToRefinance: 2_500_000,
  ecovadis: true,
  carbonFootprintScope12: true,
  carbonFootprintScope3: false,
  bankingEsgMetrics: false,
  tisaxOrNis2: false,
};

const MOLDS = { id: 'empresa-moldes', sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 } as const;
const consultant: DraftContext = { userId: 'consultora', staff: true, company: MOLDS };

describe('diagnóstico anterior a oferecer', () => {
  it('é o mais recente, venha a lista pela ordem que vier', () => {
    const older = entry('a', '2026-10-02T09:00:00.000Z');
    const newer = entry('b', '2026-11-17T19:33:57.023Z');
    expect(latestOpenable([older, newer])?.id).toBe('b');
    expect(latestOpenable([newer, older])?.id).toBe('b');
  });

  it('salta os que não se conseguem abrir', () => {
    const list = [entry('novo-que-nao-abre', '2026-11-17T10:00:00.000Z', false), entry('abre', '2026-09-01T10:00:00.000Z')];
    expect(latestOpenable(list)?.id).toBe('abre');
  });

  it('sem diagnósticos, ou só com os que não abrem, não há oferta', () => {
    expect(latestOpenable([])).toBeNull();
    expect(latestOpenable([entry('x', '2026-11-17T10:00:00.000Z', false)])).toBeNull();
  });
});

describe('respostas lidas de um diagnóstico gravado', () => {
  it('vêm todas, com o refinanciamento ligado quando havia crédito a renovar', () => {
    expect(answersFromSnapshot(savedInput)).toEqual({
      sectorProfile: 'automotive_molds',
      annualRevenue: 6_500_000,
      topClientsShare: 58,
      hasRefinancing: true,
      creditLineToRefinance: 2_500_000,
      ecovadis: true,
      carbonFootprintScope12: true,
      carbonFootprintScope3: false,
      bankingEsgMetrics: false,
      tisaxOrNis2: false,
    });
  });

  it('crédito a zero é refinanciamento desligado, e o montante não vem', () => {
    const answers = answersFromSnapshot({ ...savedInput, creditLineToRefinance: 0 });
    expect(answers).toMatchObject({ hasRefinancing: false });
    expect(answers).not.toHaveProperty('creditLineToRefinance');
  });

  it('ignora o que o servidor mandar a mais', () => {
    const answers = answersFromSnapshot({ ...savedInput, companyName: 'Outra, Lda', touched: false, owner: 'alguém' });
    expect(Object.keys(answers ?? {}).sort()).toEqual(Object.keys(answersFromSnapshot(savedInput) ?? {}).sort());
  });

  it.each([
    ['não é um objeto', 'texto'],
    ['nulo', null],
    ['sem uma das respostas', (({ tisaxOrNis2: _t, ...rest }) => rest)(savedInput)],
    ['sem o crédito', (({ creditLineToRefinance: _c, ...rest }) => rest)(savedInput)],
    ['setor desconhecido', { ...savedInput, sectorProfile: 'textil' }],
    ['faturação negativa', { ...savedInput, annualRevenue: -1 }],
    ['concentração acima de 100', { ...savedInput, topClientsShare: 140 }],
    ['resposta que não é sim ou não', { ...savedInput, ecovadis: 'sim' }],
  ])('recusa um diagnóstico %s', (_label, input) => {
    expect(answersFromSnapshot(input)).toBeNull();
  });
});

describe('aplicar as respostas ao rascunho', () => {
  const answers = answersFromSnapshot(savedInput);
  if (!answers) throw new Error('respostas de teste inválidas');

  it('conta como alteração do utilizador e não mexe no resto do rascunho', () => {
    const draft = freshDraft(consultant);
    const applied = applyPreviousAnswers(draft, answers);
    expect(applied).toMatchObject({ ...answers, touched: true, owner: 'consultora', prefilledFor: MOLDS.id, newCompany: false });
    expect(draft.touched).toBe(false);
  });

  it('o que vai para o motor são as respostas do diagnóstico anterior', () => {
    expect(toStressTestInput(applyPreviousAnswers(freshDraft(consultant), answers))).toEqual(savedInput);
  });

  it('sem refinanciamento no diagnóstico anterior, o montante que estava no rascunho fica', () => {
    const none = answersFromSnapshot({ ...savedInput, creditLineToRefinance: 0 });
    if (!none) throw new Error('respostas de teste inválidas');
    const applied = applyPreviousAnswers({ ...freshDraft(consultant), hasRefinancing: true, creditLineToRefinance: 900_000 }, none);
    expect(applied).toMatchObject({ hasRefinancing: false, creditLineToRefinance: 900_000 });
    expect(toStressTestInput(applied).creditLineToRefinance).toBe(0);
  });

  it('depois de aplicadas, recarregar a página não as troca pela ficha da empresa', () => {
    const applied = applyPreviousAnswers(freshDraft(consultant), answers);
    expect(reconcileDraft(applied, consultant).draft).toBe(applied);
  });

  it('o estado por omissão continua a ser o pior caso: nada é aplicado sozinho', () => {
    expect(freshDraft(consultant)).toMatchObject({ ecovadis: false, carbonFootprintScope12: false, topClientsShare: DEFAULT_STATE.topClientsShare });
  });
});

describe('respostas anteriores e ficha da empresa', () => {
  const record = { sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 } as const;

  it('iguais à ficha, não há nada a assinalar', () => {
    expect(differencesFromRecord({ sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 }, record)).toEqual({ sector: false, revenue: false });
  });

  it('a ficha foi corrigida depois do diagnóstico', () => {
    expect(differencesFromRecord({ sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 }, { ...record, annualRevenue: 7_200_000 })).toEqual({
      sector: false,
      revenue: true,
    });
    expect(differencesFromRecord({ sectorProfile: 'heavy_process', annualRevenue: 6_500_000 }, record)).toEqual({ sector: true, revenue: false });
  });

  it('uma ficha sem faturação não conta como diferença', () => {
    expect(differencesFromRecord({ sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 }, { ...record, annualRevenue: 0 }).revenue).toBe(false);
  });
});
