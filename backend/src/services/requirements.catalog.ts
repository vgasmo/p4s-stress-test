// Catálogo fechado de requisitos do stress test. Cada requisito tem um remetente
// comercial ou legal concreto (cliente industrial, banco ou NIS2). Não há tarefas
// genéricas: só se gera trabalho a partir desta lista.
// Sem dependências de Node: o frontend importa este ficheiro para o preview em tempo real.

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

export type RequirementSource = 'industrial_client' | 'bank' | 'nis2_directive';

export const REQUIREMENT_SOURCE_LABELS: Record<RequirementSource, string> = {
  industrial_client: 'Cliente industrial',
  bank: 'Banco',
  nis2_directive: 'Diretiva NIS2',
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

export type RequirementStatus = 'compliant' | 'gap' | 'not_applicable';

export interface RequirementTaskTemplate {
  title: string;
  description: string;
  domain: TaskDomain;
  priority: TaskPriority;
  phase: TaskPhase;
  executorType: TaskExecutor;
  /** Honorários fixos (€). */
  estimatedCost: number;
  deadlineDays: number;
}

export interface ResolvedRequirement {
  /** Peso comercial em pontos (35 = +0,35). Inteiro para evitar erros de vírgula flutuante. */
  weightPoints: number;
  task: RequirementTaskTemplate;
}

export interface RequirementRule {
  code: RequirementCode;
  label: string;
  channel: RiskChannel;
  requiredBy: readonly RequirementSource[];
  isApplicable: (input: StressTestInput) => boolean;
  isMet: (input: StressTestInput) => boolean;
  /** Peso e tarefa dependem do perfil setorial. */
  resolve: (sector: SectorProfile) => ResolvedRequirement;
}

/** Agravamento de spread aplicado ao crédito a refinanciar sem rácios ESG: 40 bps/ano. */
export const SPREAD_PENALTY_BPS = 40;

const ECOVADIS_HEAVY_SECTORS: readonly SectorProfile[] = ['automotive_molds', 'agro_packaging'];

export const REQUIREMENT_CATALOG: readonly RequirementRule[] = [
  {
    code: 'ecovadis',
    label: 'EcoVadis',
    channel: 'commercial',
    requiredBy: ['industrial_client'],
    isApplicable: () => true,
    isMet: (input) => input.ecovadis,
    resolve: (sector) => ({
      weightPoints: ECOVADIS_HEAVY_SECTORS.includes(sector) ? 45 : 35,
      task: {
        title: 'Preparação e Submissão do Dossier EcoVadis',
        description:
          'Recolha de políticas e evidências nos quatro temas EcoVadis (ambiente, práticas laborais e direitos humanos, ética, compras sustentáveis) e submissão do questionário pedido pelos clientes.',
        domain: 'ecovadis',
        priority: 'critical',
        phase: 'phase_1_urgent',
        executorType: 'p4s',
        estimatedCost: 3500,
        deadlineDays: 60,
      },
    }),
  },
  {
    code: 'carbon_scope_1_2',
    label: 'Pegada de carbono, âmbitos 1 e 2',
    channel: 'commercial',
    requiredBy: ['industrial_client'],
    isApplicable: () => true,
    isMet: (input) => input.carbonFootprintScope12,
    resolve: () => ({
      weightPoints: 30,
      task: {
        title: 'Inventário de Emissões GEE (Âmbitos 1 e 2)',
        description:
          'Cálculo das emissões diretas e da energia adquirida segundo o GHG Protocol, no formato pedido nos questionários de fornecedor dos clientes.',
        domain: 'carbon_footprint',
        priority: 'critical',
        phase: 'phase_1_urgent',
        executorType: 'p4s',
        estimatedCost: 2400,
        deadlineDays: 45,
      },
    }),
  },
  {
    code: 'carbon_scope_3',
    label: 'Pegada de carbono, âmbito 3',
    channel: 'commercial',
    requiredBy: ['industrial_client'],
    isApplicable: () => true,
    isMet: (input) => input.carbonFootprintScope3,
    resolve: (sector) => ({
      weightPoints: sector === 'automotive_molds' ? 30 : 20,
      task: {
        title: 'Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3)',
        description:
          'Estimativa das emissões indiretas nas categorias relevantes (bens adquiridos, transporte, fim de vida do produto) para responder às metas de redução dos clientes.',
        domain: 'carbon_footprint',
        priority: 'high',
        phase: 'phase_2_structural',
        executorType: 'p4s',
        estimatedCost: 3800,
        deadlineDays: 90,
      },
    }),
  },
  {
    code: 'banking_esg',
    label: 'Rácios ESG para a banca',
    channel: 'financial',
    requiredBy: ['bank'],
    // Só conta se houver crédito a renovar nos próximos 18 meses.
    isApplicable: (input) => input.creditLineToRefinance > 0,
    isMet: (input) => input.bankingEsgMetrics,
    resolve: () => ({
      weightPoints: 0,
      task: {
        title: 'Dossier de Sustentabilidade para Indexação de Spread Bancário',
        description:
          'Indicadores ESG e evidências pedidos pela banca no processo de refinanciamento, para evitar agravamento do spread.',
        domain: 'banking_esg',
        priority: 'high',
        phase: 'phase_1_urgent',
        executorType: 'p4s',
        estimatedCost: 1800,
        deadlineDays: 30,
      },
    }),
  },
  {
    code: 'information_security',
    label: 'Segurança da informação (TISAX / NIS2)',
    channel: 'commercial',
    requiredBy: ['industrial_client', 'nis2_directive'],
    isApplicable: () => true,
    isMet: (input) => input.tisaxOrNis2,
    resolve: (sector) => {
      const automotive = sector === 'automotive_molds';
      return {
        weightPoints: automotive ? 35 : 15,
        task: {
          title: 'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX',
          description:
            'Auditoria e plano de conformidade executados por parceiro acreditado. TISAX quando exigido por clientes do setor automóvel, NIS2 quando a empresa está no âmbito da diretiva.',
          domain: 'information_security',
          priority: automotive ? 'critical' : 'high',
          phase: automotive ? 'phase_1_urgent' : 'phase_2_structural',
          executorType: 'partner',
          estimatedCost: 4500,
          deadlineDays: 75,
        },
      };
    },
  },
];

/**
 * Regra de dealbreaker setorial: certas lacunas bloqueiam o acesso a novos pedidos de
 * cotação, por isso o peso comercial nunca fica abaixo do piso.
 */
export interface SectorDealbreaker {
  sector: SectorProfile;
  floorPoints: number;
  triggers: readonly RequirementCode[];
  reason: string;
}

export const SECTOR_DEALBREAKERS: readonly SectorDealbreaker[] = [
  {
    sector: 'automotive_molds',
    floorPoints: 75,
    triggers: ['information_security', 'carbon_scope_1_2'],
    reason: 'Sem TISAX/NIS2 ou sem pegada de âmbitos 1 e 2, a fábrica fica fora de novos RFQ do setor automóvel.',
  },
  {
    sector: 'agro_packaging',
    floorPoints: 65,
    triggers: ['ecovadis', 'carbon_scope_1_2'],
    reason: 'Sem EcoVadis ou sem pegada de âmbitos 1 e 2, a qualificação como fornecedor de embalagem agroalimentar fica bloqueada.',
  },
];

export function evaluateRequirement(rule: RequirementRule, input: StressTestInput): RequirementStatus {
  if (!rule.isApplicable(input)) return 'not_applicable';
  return rule.isMet(input) ? 'compliant' : 'gap';
}

export function describeSources(sources: readonly RequirementSource[]): string {
  return sources.map((source) => REQUIREMENT_SOURCE_LABELS[source]).join(' / ');
}

export const TASK_PHASE_LABELS: Record<TaskPhase, string> = {
  phase_1_urgent: 'Fase 1 · Desbloqueio imediato',
  phase_2_structural: 'Fase 2 · Estruturação',
};
