import { describe, expect, it } from 'vitest';
import type { AssessmentSnapshot } from '@engine/models/api.types';
import { canEditProposalTerms, isAfterPhaseWindow, isOverdue, phaseEndDate, requiredByOf, taskEditScope } from './task-rules';

describe('o que cada perfil altera numa tarefa', () => {
  it('a equipa P4S altera tudo, seja qual for a origem', () => {
    for (const origin of ['assessment', 'p4s', 'company'] as const) {
      expect(taskEditScope({ origin }, true)).toBe('all');
      expect(canEditProposalTerms({ origin }, true)).toBe(true);
    }
  });

  it('a empresa só acompanha as tarefas do diagnóstico e as criadas pela P4S', () => {
    expect(taskEditScope({ origin: 'assessment' }, false)).toBe('follow-up');
    expect(taskEditScope({ origin: 'p4s' }, false)).toBe('follow-up');
    expect(canEditProposalTerms({ origin: 'assessment' }, false)).toBe(false);
  });

  it('a empresa altera as tarefas que ela própria criou', () => {
    expect(taskEditScope({ origin: 'company' }, false)).toBe('own');
    expect(canEditProposalTerms({ origin: 'company' }, false)).toBe(true);
  });
});

describe('quem exige um entregável', () => {
  const snapshot = {
    requirements: [
      { code: 'ecovadis', requiredByLabel: 'Cliente industrial' },
      { code: 'information_security', requiredByLabel: 'Cliente industrial / NIS2 (se a empresa estiver abrangida)' },
    ],
  } as unknown as AssessmentSnapshot;

  it('lê-se do requisito que gerou a tarefa', () => {
    expect(requiredByOf({ requirementCode: 'information_security' }, snapshot)).toBe(
      'Cliente industrial / NIS2 (se a empresa estiver abrangida)',
    );
  });

  it('uma tarefa criada à mão não tem remetente, escreva-se o que se escrever na descrição', () => {
    expect(requiredByOf({ requirementCode: null }, snapshot)).toBeNull();
  });

  it('um requisito que o diagnóstico não tem não inventa remetente', () => {
    expect(requiredByOf({ requirementCode: 'banking_esg' }, snapshot)).toBeNull();
  });
});

describe('prazos', () => {
  it('as janelas das fases contam a partir da data de emissão da proposta', () => {
    expect(phaseEndDate('2026-11-17', 'phase_1_urgent')).toBe('2027-01-16');
    expect(phaseEndDate('2026-11-17', 'phase_2_structural')).toBe('2027-03-17');
  });

  it('assinala o prazo que passa do fim da fase', () => {
    expect(isAfterPhaseWindow({ deadline: '2027-01-16', phase: 'phase_1_urgent' }, '2026-11-17')).toBe(false);
    expect(isAfterPhaseWindow({ deadline: '2027-01-17', phase: 'phase_1_urgent' }, '2026-11-17')).toBe(true);
    expect(isAfterPhaseWindow({ deadline: null, phase: 'phase_1_urgent' }, '2026-11-17')).toBe(false);
  });

  it('uma tarefa concluída nunca está em atraso', () => {
    expect(isOverdue({ deadline: '2026-11-01', status: 'backlog' }, '2026-11-17')).toBe(true);
    expect(isOverdue({ deadline: '2026-11-01', status: 'completed' }, '2026-11-17')).toBe(false);
    expect(isOverdue({ deadline: '2026-11-17', status: 'backlog' }, '2026-11-17')).toBe(false);
  });
});
