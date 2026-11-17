// Guardar um diagnóstico são dois passos: gravá-lo e passar a sessão para a empresa dele (quando
// a empresa foi registada na hora). Se o segundo falhar, o diagnóstico já existe. Repetir tem de
// repetir só a troca de empresa, nunca gravar outro igual.

import type { AssessmentDetail, CompanyResolution, CreatedAssessment } from '@engine/models/api.types';

/** Diagnóstico gravado cujo plano ainda não abriu. */
export interface SavedAssessment {
  /** Quem gravou. Outra pessoa no mesmo separador não o herda. */
  userId: string;
  /** Impressão digital do que foi enviado. Com outras respostas ou outra empresa é outro diagnóstico. */
  fingerprint: string;
  assessmentId: string;
  companyId: string;
  companyResolution: CompanyResolution;
}

/** O diagnóstico ficou gravado, mas o plano não abriu. Repetir só repete a abertura. */
export class AssessmentSavedError extends Error {
  readonly assessmentId: string;
  readonly companyId: string;

  constructor(
    saved: Pick<SavedAssessment, 'assessmentId' | 'companyId'>,
    /** O que falhou ao abrir o plano. */
    readonly reason: unknown,
    reasonText: string,
  ) {
    super(`O diagnóstico ficou guardado. Falta só abrir o plano. ${reasonText}`);
    this.name = 'AssessmentSavedError';
    this.assessmentId = saved.assessmentId;
    this.companyId = saved.companyId;
  }
}

/** Distingue «gravado, mas o plano não abriu» de uma gravação que falhou. */
export function isSavedButNotOpened(error: unknown): error is AssessmentSavedError {
  return error instanceof AssessmentSavedError;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Impressão digital do pedido, igual seja qual for a ordem dos campos. É um resumo numérico
 * (cyrb53): as respostas do cliente não ficam escritas no separador depois de «Sair».
 */
export function fingerprintOf(payload: unknown): string {
  const text = stable(payload);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const RESOLUTIONS: readonly string[] = ['session', 'created', 'existing'] satisfies readonly CompanyResolution[];

function isSavedAssessment(value: unknown): value is SavedAssessment {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    ['userId', 'fingerprint', 'assessmentId', 'companyId'].every((key) => typeof record[key] === 'string' && record[key] !== '') &&
    typeof record.companyResolution === 'string' &&
    RESOLUTIONS.includes(record.companyResolution)
  );
}

interface Remembered extends SavedAssessment {
  /** Resposta da gravação, enquanto a página não for recarregada. */
  detail: CreatedAssessment | null;
}

export interface SaveMemory {
  get: () => Remembered | null;
  set: (saved: SavedAssessment | null, detail?: CreatedAssessment) => void;
}

/**
 * Onde fica o diagnóstico gravado à espera de abrir. O registo vai para o armazenamento do
 * separador, para valer também depois de recarregar a página. O detalhe fica só em memória.
 */
export function createSaveMemory(storage: { read: () => unknown; write: (saved: SavedAssessment | null) => void }): SaveMemory {
  let kept: CreatedAssessment | null = null;
  return {
    get() {
      const saved = storage.read();
      if (!isSavedAssessment(saved)) return null;
      return { ...saved, detail: kept?.id === saved.assessmentId ? kept : null };
    },
    set(saved, detail) {
      kept = saved && detail ? detail : null;
      storage.write(saved);
    },
  };
}

export interface SaveRequest {
  userId: string;
  fingerprint: string;
  /** Empresa da sessão, lida no momento (a gravação pode ter demorado). */
  sessionCompanyId: () => string | null | undefined;
}

export interface SaveSteps {
  create: () => Promise<CreatedAssessment>;
  /** Passa a sessão para a empresa do diagnóstico. */
  open: (companyId: string) => Promise<unknown>;
  /** Volta a ler um diagnóstico já gravado (a página foi recarregada entretanto). */
  load: (assessmentId: string) => Promise<AssessmentDetail>;
  describe: (error: unknown) => string;
}

const isNotFound = (error: unknown) => (error as { status?: unknown } | null)?.status === 404;

/**
 * Grava o diagnóstico e abre o plano. Se já houver um gravado com este mesmo pedido, à espera
 * de abrir, não grava outro: repete só o que faltou.
 */
export async function saveAndOpenAssessment(request: SaveRequest, memory: SaveMemory, steps: SaveSteps): Promise<CreatedAssessment> {
  let saved = memory.get();
  if (!saved || saved.userId !== request.userId || saved.fingerprint !== request.fingerprint) {
    memory.set(null);
    const detail = await steps.create();
    const record: SavedAssessment = {
      userId: request.userId,
      fingerprint: request.fingerprint,
      assessmentId: detail.id,
      companyId: detail.company.id,
      companyResolution: detail.companyResolution,
    };
    memory.set(record, detail);
    saved = { ...record, detail };
  }

  try {
    if (request.sessionCompanyId() !== saved.companyId) await steps.open(saved.companyId);
  } catch (error) {
    throw new AssessmentSavedError(saved, error, steps.describe(error));
  }

  let detail = saved.detail;
  if (!detail) {
    try {
      detail = { ...(await steps.load(saved.assessmentId)), companyResolution: saved.companyResolution };
    } catch (error) {
      // Eliminado entretanto por outra pessoa: já não há nada guardado, o erro é o que o servidor deu.
      if (isNotFound(error)) {
        memory.set(null);
        throw error;
      }
      throw new AssessmentSavedError(saved, error, steps.describe(error));
    }
  }
  memory.set(null);
  return detail;
}
