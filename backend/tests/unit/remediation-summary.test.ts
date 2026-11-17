import { describe, expect, it } from 'vitest';
import { summarizeRemediation, type ProposalLine } from '../../src/services/remediation-summary.js';

const plan: ProposalLine[] = [
  { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 3500, includedInProposal: true },
  { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 2400, includedInProposal: true },
  { phase: 'phase_2_structural', executorType: 'partner', estimatedCost: 4500, includedInProposal: true },
];

describe('summarizeRemediation (configurador de proposta)', () => {
  it('soma honorários por fase', () => {
    expect(summarizeRemediation(plan, 1_000_000, 0)).toEqual({
      phase1Cost: 5_900,
      phase2Cost: 4_500,
      totalInvestment: 10_400,
      protectionRatio: 96.15,
      phase1CostShareOfRisk: 0.59,
    });
  });

  it('desligar uma tarefa tira-a do orçamento', () => {
    const [ecovadis, ...rest] = plan;
    const lines = [{ ...(ecovadis as ProposalLine), includedInProposal: false }, ...rest];
    expect(summarizeRemediation(lines, 1_000_000, 0).phase1Cost).toBe(2_400);
  });

  it('passar uma tarefa para «Interno» tira-a do orçamento', () => {
    const lines = plan.map((line) =>
      line.executorType === 'partner' ? { ...line, executorType: 'internal' as const } : line,
    );
    const summary = summarizeRemediation(lines, 1_000_000, 0);
    expect(summary.phase2Cost).toBe(0);
    expect(summary.totalInvestment).toBe(5_900);
  });

  it('inclui a penalização bancária no rácio de proteção', () => {
    expect(summarizeRemediation(plan, 1_000_000, 12_000).protectionRatio).toBe(97.31);
  });

  it('sem investimento divide por 1 e sem risco não calcula a percentagem', () => {
    expect(summarizeRemediation([], 5_000, 0)).toMatchObject({ totalInvestment: 0, protectionRatio: 5_000 });
    expect(summarizeRemediation(plan, 0, 0).phase1CostShareOfRisk).toBeNull();
  });

  it('soma cêntimos sem erro de vírgula flutuante', () => {
    const lines: ProposalLine[] = [
      { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 0.1, includedInProposal: true },
      { phase: 'phase_1_urgent', executorType: 'p4s', estimatedCost: 0.2, includedInProposal: true },
    ];
    expect(summarizeRemediation(lines, 0, 0).phase1Cost).toBe(0.3);
  });
});
