// Parte PÚBLICA do catálogo: que requisitos existem, quem os exige e como se avaliam.
// Não tem pesos, pisos, preços nem prazos. Esses ficam em catalog.private.ts, só no
// servidor, e chegam ao browser pela API a quem tem sessão.
// Sem dependências de Node: o frontend importa este ficheiro.

import type {
  SectorProfile,
  TaskDomain,
  TaskExecutor,
  TaskPhase,
  TaskPriority,
} from '../models/domain.js';

export type RequirementCode =
  | 'ecovadis'
  | 'carbon_scope_1_2'
  | 'carbon_scope_3'
  | 'banking_esg'
  | 'information_security';

/**
 * Quem exige. A NIS2 só obriga as empresas abrangidas (depende do setor e da dimensão),
 * por isso nunca é apresentada como obrigação certa: confirma-se caso a caso.
 */
export type RequirementSource = 'industrial_client' | 'bank' | 'nis2_if_in_scope';

export const REQUIREMENT_SOURCE_LABELS: Record<RequirementSource, string> = {
  industrial_client: 'Cliente industrial',
  bank: 'Banco',
  nis2_if_in_scope: 'NIS2 (se a empresa estiver abrangida)',
};

/**
 * commercial: pesa na faturação exposta (clientes).
 * financial: gera sobrecusto de spread (€/ano). Nunca soma ao risco de faturação.
 */
export type RiskChannel = 'commercial' | 'financial';

/** Respostas do stress test (5 minutos em reunião). */
export interface StressTestInput {
  sectorProfile: SectorProfile;
  /** Faturação anual (€). */
  annualRevenue: number;
  /** Peso dos 3 maiores clientes na faturação, em % (0–100). */
  topClientsShare: number;
  /** Crédito a renovar nos próximos 18 meses (€). 0 = sem refinanciamento. */
  creditLineToRefinance: number;
  ecovadis: boolean;
  carbonFootprintScope12: boolean;
  carbonFootprintScope3: boolean;
  bankingEsgMetrics: boolean;
  tisaxOrNis2: boolean;
}

export type AnswerField =
  | 'ecovadis'
  | 'carbonFootprintScope12'
  | 'carbonFootprintScope3'
  | 'bankingEsgMetrics'
  | 'tisaxOrNis2';

export const ANSWER_FIELDS = [
  'ecovadis',
  'carbonFootprintScope12',
  'carbonFootprintScope3',
  'bankingEsgMetrics',
  'tisaxOrNis2',
] as const satisfies readonly AnswerField[];

export type RequirementStatus = 'compliant' | 'gap' | 'not_applicable';

export interface RequirementDefinition {
  code: RequirementCode;
  label: string;
  /** O que é, em linguagem de fábrica, e o que conta como «já tem». */
  summary: string;
  channel: RiskChannel;
  requiredBy: readonly RequirementSource[];
  /** Resposta do stress test que diz se a fábrica já tem isto. */
  answerField: AnswerField;
  /** credit_line: só conta se houver crédito a renovar nos próximos 18 meses. */
  appliesWhen: 'always' | 'credit_line';
}

/** Âmbito fechado: só existem estes requisitos, todos com remetente concreto. */
export const REQUIREMENTS: readonly RequirementDefinition[] = [
  {
    code: 'ecovadis',
    label: 'EcoVadis',
    summary:
      'Avaliação de sustentabilidade que os clientes pedem aos fornecedores. Conta se a empresa tem uma avaliação EcoVadis dentro da validade.',
    channel: 'commercial',
    requiredBy: ['industrial_client'],
    answerField: 'ecovadis',
    appliesWhen: 'always',
  },
  {
    code: 'carbon_scope_1_2',
    label: 'Pegada de carbono, âmbitos 1 e 2',
    summary: 'Emissões diretas da fábrica e da energia que compra. Conta se tem o cálculo do último ano.',
    channel: 'commercial',
    requiredBy: ['industrial_client'],
    answerField: 'carbonFootprintScope12',
    appliesWhen: 'always',
  },
  {
    code: 'carbon_scope_3',
    label: 'Pegada de carbono, âmbito 3',
    summary:
      'Emissões da cadeia de valor: compras, transporte, uso e fim de vida do produto. Conta se já as estimou nas categorias que os clientes pedem.',
    channel: 'commercial',
    requiredBy: ['industrial_client'],
    answerField: 'carbonFootprintScope3',
    appliesWhen: 'always',
  },
  {
    code: 'banking_esg',
    label: 'Rácios ESG para a banca',
    summary: 'Indicadores de sustentabilidade que o banco pede para renovar ou conceder crédito. Conta se já os entrega ao banco.',
    channel: 'financial',
    requiredBy: ['bank'],
    answerField: 'bankingEsgMetrics',
    appliesWhen: 'credit_line',
  },
  {
    code: 'information_security',
    label: 'Segurança da informação (TISAX / NIS2)',
    summary:
      'TISAX é a avaliação de segurança da informação usada no setor automóvel. A NIS2 é a diretiva europeia de cibersegurança, que só abrange parte das empresas. Conta se tem a avaliação ou o plano de conformidade em dia.',
    channel: 'commercial',
    requiredBy: ['industrial_client', 'nis2_if_in_scope'],
    answerField: 'tisaxOrNis2',
    appliesWhen: 'always',
  },
];

export function requirementStatus(definition: RequirementDefinition, input: StressTestInput): RequirementStatus {
  if (definition.appliesWhen === 'credit_line' && !(input.creditLineToRefinance > 0)) return 'not_applicable';
  return input[definition.answerField] ? 'compliant' : 'gap';
}

export function describeSources(sources: readonly RequirementSource[]): string {
  return sources.map((source) => REQUIREMENT_SOURCE_LABELS[source]).join(' / ');
}

// ── Fases ───────────────────────────────────────────────────────────────────────────

export interface PhaseWindow {
  label: string;
  /** Dias depois do diagnóstico. Uma tarefa da fase tem prazo em ]afterDay, untilDay]. */
  afterDay: number;
  untilDay: number;
}

/**
 * Janelas das fases, contadas a partir do dia do diagnóstico. São a promessa comercial
 * («Fase 1: 0–60 dias»), por isso nenhuma tarefa-tipo pode ter prazo fora da sua fase.
 */
export const PHASE_WINDOWS: Record<TaskPhase, PhaseWindow> = {
  phase_1_urgent: { label: 'Fase 1 · Desbloqueio imediato', afterDay: 0, untilDay: 60 },
  phase_2_structural: { label: 'Fase 2 · Estruturação', afterDay: 60, untilDay: 120 },
};

export const phaseWindowText = (phase: TaskPhase) =>
  `${PHASE_WINDOWS[phase].afterDay}–${PHASE_WINDOWS[phase].untilDay} dias`;

export function isWithinPhase(phase: TaskPhase, deadlineDays: number): boolean {
  const { afterDay, untilDay } = PHASE_WINDOWS[phase];
  return deadlineDays > afterDay && deadlineDays <= untilDay;
}

// ── Parâmetros privados (só a forma; os valores vivem em catalog.private.ts) ─────────

/** Valor por omissão com exceções por setor. */
export interface SectorValue<T> {
  default: T;
  bySector?: Partial<Record<SectorProfile, T>>;
}

export function forSector<T>(value: SectorValue<T>, sector: SectorProfile): T {
  return value.bySector?.[sector] ?? value.default;
}

export interface RequirementParameters {
  /** Peso comercial em pontos (35 = +0,35). Inteiro, para evitar erros de vírgula flutuante. */
  weightPoints: SectorValue<number>;
  /** Caso ou fonte que sustenta o peso. Aparece nos pressupostos quando existe. */
  evidence?: string;
  task: {
    title: string;
    description: string;
    domain: TaskDomain;
    executorType: TaskExecutor;
    /** Honorários fixos (€). */
    estimatedCost: number;
    priority: SectorValue<TaskPriority>;
    phase: SectorValue<TaskPhase>;
    deadlineDays: SectorValue<number>;
  };
}

/** Tarefa-tipo já resolvida para um setor. */
export interface RequirementTaskTemplate {
  title: string;
  description: string;
  domain: TaskDomain;
  priority: TaskPriority;
  phase: TaskPhase;
  executorType: TaskExecutor;
  estimatedCost: number;
  deadlineDays: number;
}

/**
 * Bloqueio setorial: certas lacunas tiram a fábrica de novos pedidos de cotação, por
 * isso o peso comercial nunca fica abaixo do piso.
 */
export interface SectorDealbreaker {
  sector: SectorProfile;
  floorPoints: number;
  triggers: readonly RequirementCode[];
  reason: string;
}

export interface Catalog {
  /** Versão dos parâmetros e das fórmulas. Fica gravada em cada diagnóstico. */
  version: string;
  /** Agravamento de spread, em pontos base por ano, sobre o crédito a refinanciar sem rácios ESG. */
  spreadPenaltyBps: number;
  parameters: Record<RequirementCode, RequirementParameters>;
  dealbreakers: readonly SectorDealbreaker[];
}

export function resolveTask(parameters: RequirementParameters, sector: SectorProfile): RequirementTaskTemplate {
  const { task } = parameters;
  return {
    title: task.title,
    description: task.description,
    domain: task.domain,
    priority: forSector(task.priority, sector),
    phase: forSector(task.phase, sector),
    executorType: task.executorType,
    estimatedCost: task.estimatedCost,
    deadlineDays: forSector(task.deadlineDays, sector),
  };
}
