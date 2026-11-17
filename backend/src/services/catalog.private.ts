// Parte PRIVADA do catálogo: pesos, pisos, agravamento de spread, preços e prazos.
//
// SÓ NO SERVIDOR. O frontend nunca importa este ficheiro: recebe o catálogo pela rota
// autenticada GET /api/v1/catalog. A verificação `npm run check:bundle` do frontend
// falha se algum destes valores aparecer no código público.
//
// Os pesos e o agravamento de spread são pressupostos de trabalho da P4S, a calibrar com
// casos reais. Quando houver um caso ou uma fonte, regista-se em `evidence` e passa a
// aparecer nos pressupostos do diagnóstico.

import type { Catalog } from './requirements.js';

export const CATALOG: Catalog = {
  version: '3.0.0',
  spreadPenaltyBps: 40,
  parameters: {
    ecovadis: {
      weightPoints: { default: 35, bySector: { automotive_molds: 45, agro_packaging: 45 } },
      task: {
        title: 'Preparação e Submissão do Dossier EcoVadis',
        description:
          'Recolha de políticas e evidências nos quatro temas EcoVadis (ambiente, práticas laborais e direitos humanos, ética, compras sustentáveis) e submissão do questionário pedido pelos clientes.',
        domain: 'ecovadis',
        executorType: 'p4s',
        estimatedCost: 3500,
        priority: { default: 'critical' },
        phase: { default: 'phase_1_urgent' },
        deadlineDays: { default: 60 },
      },
    },
    carbon_scope_1_2: {
      weightPoints: { default: 30 },
      task: {
        title: 'Inventário de Emissões GEE (Âmbitos 1 e 2)',
        description:
          'Cálculo das emissões diretas e da energia adquirida segundo o GHG Protocol, no formato pedido nos questionários de fornecedor dos clientes.',
        domain: 'carbon_footprint',
        executorType: 'p4s',
        estimatedCost: 2400,
        priority: { default: 'critical' },
        phase: { default: 'phase_1_urgent' },
        deadlineDays: { default: 45 },
      },
    },
    carbon_scope_3: {
      weightPoints: { default: 20, bySector: { automotive_molds: 30 } },
      task: {
        title: 'Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3)',
        description:
          'Estimativa das emissões indiretas nas categorias relevantes (bens adquiridos, transporte, fim de vida do produto) para responder às metas de redução dos clientes.',
        domain: 'carbon_footprint',
        executorType: 'p4s',
        estimatedCost: 3800,
        priority: { default: 'high' },
        phase: { default: 'phase_2_structural' },
        deadlineDays: { default: 90 },
      },
    },
    banking_esg: {
      // Canal financeiro: não pesa na faturação. Conta pelo agravamento de spread.
      weightPoints: { default: 0 },
      task: {
        title: 'Dossier de Sustentabilidade para Indexação de Spread Bancário',
        description:
          'Indicadores ESG e evidências pedidos pela banca no processo de refinanciamento, para evitar agravamento do spread.',
        domain: 'banking_esg',
        executorType: 'p4s',
        estimatedCost: 1800,
        priority: { default: 'high' },
        phase: { default: 'phase_1_urgent' },
        deadlineDays: { default: 30 },
      },
    },
    information_security: {
      weightPoints: { default: 15, bySector: { automotive_molds: 35 } },
      task: {
        title: 'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX',
        description:
          'Auditoria e plano de conformidade executados por parceiro acreditado. TISAX quando exigido por clientes do setor automóvel. A auditoria confirma se a empresa está abrangida pela NIS2, o que depende do setor e da dimensão.',
        domain: 'information_security',
        executorType: 'partner',
        estimatedCost: 4500,
        priority: { default: 'high', bySector: { automotive_molds: 'critical' } },
        phase: { default: 'phase_2_structural', bySector: { automotive_molds: 'phase_1_urgent' } },
        // No automóvel bloqueia novos pedidos de cotação e entra na Fase 1, por isso cumpre a janela dos 60 dias.
        deadlineDays: { default: 75, bySector: { automotive_molds: 60 } },
      },
    },
  },
  dealbreakers: [
    {
      sector: 'automotive_molds',
      floorPoints: 75,
      triggers: ['information_security', 'carbon_scope_1_2'],
      reason:
        'Sem avaliação de segurança da informação (TISAX) ou sem pegada de âmbitos 1 e 2, a fábrica fica fora de novos pedidos de cotação do setor automóvel.',
    },
    {
      sector: 'agro_packaging',
      floorPoints: 65,
      triggers: ['ecovadis', 'carbon_scope_1_2'],
      reason:
        'Sem EcoVadis ou sem pegada de âmbitos 1 e 2, a qualificação como fornecedor de embalagem agroalimentar fica bloqueada.',
    },
  ],
};
