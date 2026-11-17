// Regras de apresentação da análise de documentos. Sem React: testam-se sozinhas.

import type {
  DocumentAnalysisSummary,
  DocumentFindingCounts,
  FindingObligation,
  RequirementEvidence,
} from '@engine/models/api.types';
import { REQUIREMENTS, type RequirementCode } from '@engine/services/requirements';
import { formatDatePt } from '@engine/utils/dates';

export const REQUIREMENT_LABELS = Object.fromEntries(REQUIREMENTS.map((definition) => [definition.code, definition.label])) as Record<
  RequirementCode,
  string
>;

/** Valor do seletor para uma exigência que não corresponde a nenhum requisito do stress test. */
export const NO_REQUIREMENT = 'other';
export const NO_REQUIREMENT_LABEL = 'Fora dos requisitos do stress test';

export const requirementLabel = (code: RequirementCode | null) => (code ? REQUIREMENT_LABELS[code] : NO_REQUIREMENT_LABEL);

export const OBLIGATION_LABELS: Record<FindingObligation, string> = {
  mandatory: 'Obrigatório',
  recommended: 'Recomendado',
  unclear: 'Por esclarecer',
};

const NUMBER = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 });

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${NUMBER.format(bytes / 1024)} KB`;
  return `${NUMBER.format(bytes / (1024 * 1024))} MB`;
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/**
 * Motivo para não enviar um ficheiro, ou null se pode seguir. O servidor volta a verificar
 * tudo pelo conteúdo: isto só poupa a espera a quem escolheu o ficheiro errado.
 */
export function fileProblem(file: { name: string; size: number }, limits: { maxBytes: number; acceptedExtensions: readonly string[] }): string | null {
  if (file.size === 0) return 'O ficheiro está vazio.';
  if (file.size > limits.maxBytes) {
    return `O ficheiro tem ${formatFileSize(file.size)} e o máximo é ${formatFileSize(limits.maxBytes)}.`;
  }
  const extension = extensionOf(file.name);
  if (['.xlsx', '.xlsm', '.xls'].includes(extension)) {
    return 'As folhas de Excel ainda não são lidas. Exporte a folha para PDF (Ficheiro > Exportar) e carregue o PDF.';
  }
  if (extension === '.doc') return 'O formato .doc antigo não é lido. Grave o documento como .docx ou PDF.';
  if (extension && !limits.acceptedExtensions.includes(extension)) {
    return `Formato não suportado (${extension}). São aceites ${limits.acceptedExtensions.join(', ')}.`;
  }
  return null;
}

/** O prazo de uma exigência: a data, o texto do documento, ou os dois quando ambos existem. */
export function deadlineLabel(item: { deadline: string | null; deadlineText: string | null }): string | null {
  if (item.deadline && item.deadlineText) return `${formatDatePt(item.deadline)} («${item.deadlineText}»)`;
  if (item.deadline) return formatDatePt(item.deadline);
  return item.deadlineText ? `«${item.deadlineText}»` : null;
}

/** O prazo em poucas palavras, para o plano e o resumo impresso: a data, ou o texto do documento se não houver data. */
export function deadlineShort(item: { deadline: string | null; deadlineText: string | null }): string | null {
  if (item.deadline) return formatDatePt(item.deadline);
  return item.deadlineText ? `«${item.deadlineText}»` : null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Resumo de uma análise numa linha: quantas exigências e o que falta rever. */
export function countsLabel(counts: DocumentFindingCounts): string {
  if (counts.total === 0) return 'Sem exigências ao fornecedor';
  const parts = [plural(counts.total, 'exigência', 'exigências')];
  if (counts.confirmed > 0) parts.push(plural(counts.confirmed, 'confirmada', 'confirmadas'));
  if (counts.pending > 0) parts.push(`${counts.pending} por rever`);
  if (counts.rejected > 0) parts.push(plural(counts.rejected, 'rejeitada', 'rejeitadas'));
  return parts.join(' · ');
}

/** Quem emitiu, que documento é e de quando: o que identifica um documento na lista. */
export function documentOrigin(analysis: Pick<DocumentAnalysisSummary, 'issuer' | 'documentType' | 'documentDate'>): string | null {
  const parts = [analysis.issuer, analysis.documentType, analysis.documentDate ? formatDatePt(analysis.documentDate) : null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** De onde vem uma citação: emitente, ficheiro e página. */
export function evidenceSource(evidence: Pick<RequirementEvidence, 'issuer' | 'fileName' | 'quotePage'>): string {
  return [evidence.issuer, evidence.fileName, evidence.quotePage ? `p. ${evidence.quotePage}` : null]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

export function evidenceByRequirement(evidence: readonly RequirementEvidence[]): Map<RequirementCode, RequirementEvidence[]> {
  const grouped = new Map<RequirementCode, RequirementEvidence[]>();
  for (const item of evidence) grouped.set(item.requirementCode, [...(grouped.get(item.requirementCode) ?? []), item]);
  return grouped;
}

/** Título do bloco de evidência de um requisito: quem pede e o prazo mais próximo. */
export function evidenceHeadline(items: readonly RequirementEvidence[]): string {
  const issuers = [...new Set(items.map((item) => item.issuer).filter((issuer): issuer is string => Boolean(issuer)))];
  const earliest = items
    .map((item) => item.deadline)
    .filter((deadline): deadline is string => Boolean(deadline))
    .sort()[0];
  const who = issuers.length === 0 ? '' : issuers.length <= 2 ? ` por ${issuers.join(' e ')}` : ` por ${issuers.length} entidades`;
  return `Exigido por escrito${who}${earliest ? `, até ${formatDatePt(earliest)}` : ''}`;
}

/** Corta uma citação longa para o resumo impresso. O corte fica sempre à vista («…»). */
export function clipQuote(quote: string, max: number): string {
  const text = quote.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
