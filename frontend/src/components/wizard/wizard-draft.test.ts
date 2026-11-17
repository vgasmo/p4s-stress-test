import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  applyToSessionCompany,
  freshDraft,
  newCompanyDraft,
  parseDraft,
  reconcileDraft,
  resumeAsNewCompany,
  toStressTestInput,
  type DraftContext,
  type WizardState,
} from './wizard-draft';

const MOLDS = { id: 'empresa-moldes', sectorProfile: 'automotive_molds', annualRevenue: 6_500_000 } as const;
const AGRO = { id: 'empresa-agro', sectorProfile: 'agro_packaging', annualRevenue: 3_000_000 } as const;

const visitor: DraftContext = { userId: null, staff: false, company: null };
const consultant = (company: DraftContext['company'] = null): DraftContext => ({ userId: 'consultora', staff: true, company });
const factoryUser: DraftContext = { userId: 'gestor', staff: false, company: MOLDS };

/** Respostas de um prospeto, introduzidas à mão. */
const prospect = (overrides: Partial<WizardState> = {}): WizardState => ({
  ...DEFAULT_STATE,
  sectorProfile: 'heavy_process',
  annualRevenue: 3_200_000,
  ecovadis: true,
  touched: true,
  ...overrides,
});

describe('rascunho novo', () => {
  it('parte do setor e da faturação da ficha da empresa', () => {
    expect(freshDraft(consultant(MOLDS))).toMatchObject({
      sectorProfile: 'automotive_molds',
      annualRevenue: 6_500_000,
      prefilledFor: MOLDS.id,
      owner: 'consultora',
      touched: false,
      newCompany: false,
    });
  });

  it('sem faturação na ficha fica o valor por omissão', () => {
    const draft = freshDraft(consultant({ ...MOLDS, annualRevenue: 0 }));
    expect(draft.annualRevenue).toBe(DEFAULT_STATE.annualRevenue);
  });

  it('empresa nova não herda nada da empresa da sessão', () => {
    expect(newCompanyDraft(consultant(MOLDS))).toMatchObject({
      newCompany: true,
      sectorProfile: DEFAULT_STATE.sectorProfile,
      annualRevenue: DEFAULT_STATE.annualRevenue,
      prefilledFor: MOLDS.id,
    });
  });
});

describe('acertar o rascunho com a sessão', () => {
  it('a simulação feita antes de entrar fica com quem entrou', () => {
    const { draft, setAside } = reconcileDraft(prospect(), consultant());
    expect(draft).toMatchObject({ annualRevenue: 3_200_000, owner: 'consultora', prefilledFor: null });
    expect(setAside).toBeNull();
  });

  it('sair limpa o rascunho', () => {
    const { draft } = reconcileDraft(prospect({ owner: 'consultora', companyName: 'Cliente A' }), visitor);
    expect(draft).toEqual({ ...DEFAULT_STATE, owner: null });
  });

  it('outra pessoa não herda o rascunho de quem lá esteve', () => {
    const { draft, setAside } = reconcileDraft(prospect({ owner: 'consultora' }), factoryUser);
    expect(draft).toEqual(freshDraft(factoryUser));
    expect(setAside).toBeNull();
  });

  it('o modo «empresa nova» sobrevive a recarregar a página com a mesma empresa selecionada', () => {
    const stored = prospect({ owner: 'consultora', prefilledFor: MOLDS.id, newCompany: true, companyNif: '509876544' });
    const { draft, setAside } = reconcileDraft(stored, consultant(MOLDS));
    expect(draft).toBe(stored);
    expect(setAside).toBeNull();
  });

  it('uma simulação da equipa P4S feita sem empresa não passa para a empresa escolhida a seguir', () => {
    const simulation = prospect({ owner: 'consultora', companyName: 'Cliente A, Lda' });
    const { draft, setAside } = reconcileDraft(simulation, consultant(MOLDS));
    expect(draft).toEqual(freshDraft(consultant(MOLDS)));
    expect(setAside).toBe(simulation);
  });

  it('o registo de uma empresa nova também fica de parte quando se troca de empresa', () => {
    const registering = prospect({ owner: 'consultora', prefilledFor: MOLDS.id, newCompany: true });
    const { draft, setAside } = reconcileDraft(registering, consultant(AGRO));
    expect(draft).toEqual(freshDraft(consultant(AGRO)));
    expect(setAside).toBe(registering);
  });

  it('trocar de empresa com um rascunho da anterior começa pela ficha da nova', () => {
    const whatIf = prospect({ owner: 'consultora', prefilledFor: MOLDS.id });
    const { draft, setAside } = reconcileDraft(whatIf, consultant(AGRO));
    expect(draft).toEqual(freshDraft(consultant(AGRO)));
    expect(setAside).toBeNull();
  });

  it('escolher «sem empresa» é uma reunião nova', () => {
    const { draft, setAside } = reconcileDraft(prospect({ owner: 'consultora', prefilledFor: MOLDS.id }), consultant());
    expect(draft).toEqual(freshDraft(consultant()));
    expect(setAside).toBeNull();
  });

  it('rascunho por tocar segue a ficha da empresa selecionada', () => {
    const { draft } = reconcileDraft({ ...DEFAULT_STATE, owner: 'consultora' }, consultant(MOLDS));
    expect(draft).toEqual(freshDraft(consultant(MOLDS)));
  });

  it('a conta de uma empresa mantém a simulação que fez antes de entrar', () => {
    const { draft, setAside } = reconcileDraft(prospect(), factoryUser);
    expect(draft).toMatchObject({ annualRevenue: 3_200_000, owner: 'gestor', prefilledFor: MOLDS.id });
    expect(setAside).toBeNull();
  });
});

describe('simulação que ficou de parte', () => {
  const setAside = prospect({ owner: 'consultora', companyName: 'Cliente A, Lda', companyNif: '509876544' });

  it('aplicada à empresa da sessão deixa de ser um registo de empresa nova', () => {
    expect(applyToSessionCompany(setAside, consultant(MOLDS))).toMatchObject({
      annualRevenue: 3_200_000,
      sectorProfile: 'heavy_process',
      ecovadis: true,
      companyName: '',
      companyNif: '',
      newCompany: false,
      prefilledFor: MOLDS.id,
      touched: true,
    });
  });

  it('retomada como empresa nova mantém o nome e o NIF escritos', () => {
    expect(resumeAsNewCompany(setAside, consultant(MOLDS))).toMatchObject({
      companyName: 'Cliente A, Lda',
      companyNif: '509876544',
      newCompany: true,
      prefilledFor: MOLDS.id,
    });
  });
});

describe('rascunho lido do storage', () => {
  it('aceita um rascunho completo e ignora campos a mais', () => {
    const stored = { ...prospect(), intruso: 'x' };
    expect(parseDraft(stored)).toEqual(prospect());
  });

  it.each([
    ['não é um objeto', 'texto'],
    ['nulo', null],
    ['de uma versão anterior (sem newCompany nem owner)', (({ newCompany: _n, owner: _o, ...old }) => old)(prospect())],
    ['setor desconhecido', { ...prospect(), sectorProfile: 'textil' }],
    ['faturação negativa', { ...prospect(), annualRevenue: -1 }],
    ['faturação que não é número', { ...prospect(), annualRevenue: '5M' }],
    ['concentração acima de 100', { ...prospect(), topClientsShare: 140 }],
    ['resposta que não é sim ou não', { ...prospect(), ecovadis: 'sim' }],
  ])('recusa um rascunho %s', (_label, stored) => {
    expect(parseDraft(stored)).toBeNull();
  });
});

describe('respostas enviadas ao motor', () => {
  it('sem refinanciamento o crédito é zero, mesmo com um valor escrito', () => {
    expect(toStressTestInput(prospect({ hasRefinancing: false, creditLineToRefinance: 2_000_000 })).creditLineToRefinance).toBe(0);
    expect(toStressTestInput(prospect({ hasRefinancing: true, creditLineToRefinance: 2_000_000 })).creditLineToRefinance).toBe(2_000_000);
  });
});
