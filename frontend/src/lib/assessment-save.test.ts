import { describe, expect, it } from 'vitest';
import type { AssessmentDetail, CreatedAssessment } from '@engine/models/api.types';
import {
  AssessmentSavedError,
  createSaveMemory,
  fingerprintOf,
  isSavedButNotOpened,
  saveAndOpenAssessment,
  type SavedAssessment,
} from './assessment-save';

const PAYLOAD = {
  sectorProfile: 'automotive_molds',
  annualRevenue: 6_500_000,
  topClientsShare: 58,
  creditLineToRefinance: 0,
  ecovadis: false,
  carbonFootprintScope12: true,
  carbonFootprintScope3: false,
  bankingEsgMetrics: false,
  tisaxOrNis2: true,
  company: { name: 'Metalomecânica Nova, Lda', nif: '507776660' },
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Um browser em miniatura: a sessão, o armazenamento do separador e uma API que conta os
 * pedidos. `reload()` faz o que recarregar a página faz: perde a memória, fica o armazenamento.
 */
function browser({ sessionCompanyId = null as string | null } = {}) {
  let stored: unknown = null;
  let memory = createSaveMemory({ read: () => stored, write: (saved) => (stored = saved) });
  const calls = { create: 0, open: [] as string[], load: [] as string[] };
  const fail: { create?: Error; open?: Error; load?: Error } = {};
  const session = { userId: 'u1', companyId: sessionCompanyId };
  let created = 0;

  const detailOf = (id: string): AssessmentDetail =>
    ({ id, company: { id: 'c-nova' }, tasks: [], riskScore: 75 }) as unknown as AssessmentDetail;

  const save = (payload: unknown = PAYLOAD) =>
    saveAndOpenAssessment(
      { userId: session.userId, fingerprint: fingerprintOf(payload), sessionCompanyId: () => session.companyId },
      memory,
      {
        create: async () => {
          calls.create += 1;
          if (fail.create) throw fail.create;
          created += 1;
          return { ...detailOf(`a${created}`), companyResolution: 'created' } as CreatedAssessment;
        },
        open: async (companyId) => {
          calls.open.push(companyId);
          if (fail.open) throw fail.open;
          session.companyId = companyId;
        },
        load: async (assessmentId) => {
          calls.load.push(assessmentId);
          if (fail.load) throw fail.load;
          return detailOf(assessmentId);
        },
        describe: (error) => (error instanceof Error ? error.message : 'Erro inesperado.'),
      },
    );

  return {
    save,
    calls,
    fail,
    session,
    stored: () => stored as SavedAssessment | null,
    setStored: (value: unknown) => (stored = value),
    reload: () => {
      memory = createSaveMemory({ read: () => stored, write: (saved) => (stored = saved) });
    },
  };
}

describe('guardar um diagnóstico e abrir o plano', () => {
  it('grava, passa a sessão para a empresa nova e não deixa nada pendente', async () => {
    const b = browser();
    const detail = await b.save();
    expect(detail).toMatchObject({ id: 'a1', companyResolution: 'created' });
    expect(b.calls).toEqual({ create: 1, open: ['c-nova'], load: [] });
    expect(b.session.companyId).toBe('c-nova');
    expect(b.stored()).toBeNull();
  });

  it('com a empresa já selecionada não há troca', async () => {
    const b = browser({ sessionCompanyId: 'c-nova' });
    await b.save();
    expect(b.calls).toEqual({ create: 1, open: [], load: [] });
  });

  it('se a gravação falhar, o erro é o da gravação e repetir volta a gravar', async () => {
    const b = browser();
    b.fail.create = new Error('Sem ligação ao servidor da P4S.');
    const error = await b.save().catch((cause: unknown) => cause);
    expect(isSavedButNotOpened(error)).toBe(false);
    expect((error as Error).message).toBe('Sem ligação ao servidor da P4S.');
    expect(b.stored()).toBeNull();

    b.fail.create = undefined;
    await b.save();
    expect(b.calls.create).toBe(2);
  });
});

describe('gravou, mas a troca de empresa falhou (frontend-8)', () => {
  it('o erro diz que o diagnóstico ficou guardado e distingue-se de uma gravação falhada', async () => {
    const b = browser();
    b.fail.open = new Error('Demasiados pedidos de sessão. Aguarde uns minutos.');
    const error = await b.save().catch((cause: unknown) => cause);

    expect(isSavedButNotOpened(error)).toBe(true);
    expect(error).toBeInstanceOf(AssessmentSavedError);
    expect((error as AssessmentSavedError).message).toBe(
      'O diagnóstico ficou guardado. Falta só abrir o plano. Demasiados pedidos de sessão. Aguarde uns minutos.',
    );
    expect(error).toMatchObject({ assessmentId: 'a1', companyId: 'c-nova', reason: b.fail.open });
    expect(b.stored()).toMatchObject({ userId: 'u1', assessmentId: 'a1', companyId: 'c-nova', companyResolution: 'created' });
  });

  it('repetir não grava outro: repete só a troca e devolve o mesmo diagnóstico', async () => {
    const b = browser();
    b.fail.open = new Error('Sem ligação ao servidor da P4S.');
    await b.save().catch(() => undefined);
    await b.save().catch(() => undefined);
    expect(b.calls).toEqual({ create: 1, open: ['c-nova', 'c-nova'], load: [] });

    b.fail.open = undefined;
    const detail = await b.save();
    expect(detail).toMatchObject({ id: 'a1', companyResolution: 'created' });
    expect(b.calls).toEqual({ create: 1, open: ['c-nova', 'c-nova', 'c-nova'], load: [] });
    expect(b.stored()).toBeNull();
  });

  it('depois de recarregar a página também não grava outro: troca e volta a ler o que ficou gravado', async () => {
    const b = browser();
    b.fail.open = new Error('Sem ligação ao servidor da P4S.');
    await b.save().catch(() => undefined);
    b.reload();

    b.fail.open = undefined;
    const detail = await b.save();
    expect(detail).toMatchObject({ id: 'a1', companyResolution: 'created' });
    expect(b.calls).toEqual({ create: 1, open: ['c-nova', 'c-nova'], load: ['a1'] });
    expect(b.stored()).toBeNull();
  });

  it('se a empresa já foi aberta pelo seletor do topo, repetir só abre o plano', async () => {
    const b = browser();
    b.fail.open = new Error('Sem ligação ao servidor da P4S.');
    await b.save().catch(() => undefined);
    b.session.companyId = 'c-nova';
    const detail = await b.save();
    expect(detail.id).toBe('a1');
    expect(b.calls).toEqual({ create: 1, open: ['c-nova'], load: [] });
  });

  it('com outras respostas é outro diagnóstico', async () => {
    const b = browser();
    b.fail.open = new Error('Sem ligação ao servidor da P4S.');
    await b.save().catch(() => undefined);
    b.fail.open = undefined;
    const detail = await b.save({ ...PAYLOAD, ecovadis: true });
    expect(detail.id).toBe('a2');
    expect(b.calls.create).toBe(2);
  });

  it('outra pessoa no mesmo separador não herda o diagnóstico de quem saiu', async () => {
    const b = browser();
    b.fail.open = new Error('Sem ligação ao servidor da P4S.');
    await b.save().catch(() => undefined);
    b.fail.open = undefined;
    b.session.userId = 'u2';
    const detail = await b.save();
    expect(detail.id).toBe('a2');
  });

  it('se voltar a ler falhar por falta de rede, o diagnóstico continua dado como guardado', async () => {
    const b = browser();
    b.fail.open = new Error('Sem ligação ao servidor da P4S.');
    await b.save().catch(() => undefined);
    b.reload();
    b.fail.open = undefined;
    b.fail.load = new HttpError(0, 'Sem ligação ao servidor da P4S.');
    const error = await b.save().catch((cause: unknown) => cause);
    expect(isSavedButNotOpened(error)).toBe(true);
    expect(b.stored()).not.toBeNull();
    expect(b.calls.create).toBe(1);
  });

  it('se o diagnóstico foi eliminado entretanto, deixa de contar como guardado', async () => {
    const b = browser();
    b.fail.open = new Error('Sem ligação ao servidor da P4S.');
    await b.save().catch(() => undefined);
    b.reload();
    b.fail.open = undefined;
    b.fail.load = new HttpError(404, 'Avaliação não encontrada.');
    const error = await b.save().catch((cause: unknown) => cause);
    expect(isSavedButNotOpened(error)).toBe(false);
    expect((error as Error).message).toBe('Avaliação não encontrada.');
    expect(b.stored()).toBeNull();

    b.fail.load = undefined;
    const detail = await b.save();
    expect(detail.id).toBe('a2');
  });

  it('um registo estragado no armazenamento do separador é ignorado', async () => {
    const record = { userId: 'u1', fingerprint: fingerprintOf(PAYLOAD), assessmentId: 'a9', companyId: 'c-nova' };
    for (const broken of ['texto', 42, {}, record, { ...record, companyResolution: 'outra' }, { ...record, companyId: '', companyResolution: 'created' }]) {
      const b = browser();
      b.setStored(broken);
      const detail = await b.save();
      expect(detail.id).toBe('a1');
      expect(b.calls.create).toBe(1);
    }
  });
});

describe('impressão digital do pedido', () => {
  it('não depende da ordem dos campos nem de campos por definir', () => {
    const { company, ...answers } = PAYLOAD;
    const reordered = {
      company: { nif: company.nif, name: company.name },
      ...Object.fromEntries(Object.entries(answers).reverse()),
      extra: undefined,
    };
    expect(Object.keys(reordered)[0]).toBe('company');
    expect(fingerprintOf(reordered)).toBe(fingerprintOf(PAYLOAD));
  });

  it('muda com qualquer resposta ou com a empresa', () => {
    const base = fingerprintOf(PAYLOAD);
    expect(fingerprintOf({ ...PAYLOAD, topClientsShare: 59 })).not.toBe(base);
    expect(fingerprintOf({ ...PAYLOAD, tisaxOrNis2: false })).not.toBe(base);
    expect(fingerprintOf({ ...PAYLOAD, company: { ...PAYLOAD.company, nif: '507776661' } })).not.toBe(base);
    expect(fingerprintOf({ ...PAYLOAD, company: undefined })).not.toBe(base);
  });

  it('não leva as respostas nem o nome da empresa', () => {
    const fingerprint = fingerprintOf(PAYLOAD);
    expect(fingerprint).toMatch(/^[0-9a-z]{1,12}$/);
    expect(fingerprint).not.toContain('507776660');
  });
});
