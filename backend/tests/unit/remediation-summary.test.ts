import { describe, expect, it } from 'vitest';
import { summarizeRemediation, type ProposalLine } from '../../src/services/remediation-summary.js';

const plan: ProposalLine[] = [
  { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 3500, includedInProposal: true },
  { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 2400, includedInProposal: true },
  { phase: 'phase_2_structural', executorType: 'partner', estimatedCost: 4500, includedInProposal: true },
];

describe('summarizeRemediation (configurador de proposta)', () => {
  it('soma honorários por fase e compara-os com a faturação em risco', () => {
    expect(summarizeRemediation(plan, 1_000_000)).toEqual({
      phase1Cost: 5_900,
      phase2Cost: 4_500,
      totalInvestment: 10_400,
      phase1CostShareOfRisk: 0.59,
      totalCostShareOfRisk: 1.04,
    });
  });

  it('desligar uma tarefa tira-a do orçamento', () => {
    const [ecovadis, ...rest] = plan;
    const lines = [{ ...(ecovadis as ProposalLine), includedInProposal: false }, ...rest];
    expect(summarizeRemediation(lines, 1_000_000).phase1Cost).toBe(2_400);
  });

  it('passar uma tarefa para «Interno» tira-a do orçamento', () => {
    const lines = plan.map((line) =>
      line.executorType === 'partner' ? { ...line, executorType: 'internal' as const } : line,
    );
    const summary = summarizeRemediation(lines, 1_000_000);
    expect(summary.phase2Cost).toBe(0);
    expect(summary.totalInvestment).toBe(5_900);
  });

  it('sem faturação em risco não calcula percentagens', () => {
    expect(summarizeRemediation(plan, 0)).toMatchObject({
      totalInvestment: 10_400,
      phase1CostShareOfRisk: null,
      totalCostShareOfRisk: null,
    });
  });

  it('não devolve nenhum múltiplo de «proteção»', () => {
    expect(summarizeRemediation(plan, 1_000_000)).not.toHaveProperty('protectionRatio');
  });

  it('soma cêntimos sem erro de vírgula flutuante', () => {
    const lines: ProposalLine[] = [
      { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 0.1, includedInProposal: true },
      { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 0.2, includedInProposal: true },
    ];
    expect(summarizeRemediation(lines, 0).phase1Cost).toBe(0.3);
  });
});
