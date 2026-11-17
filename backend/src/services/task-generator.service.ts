// Gera o plano de ação a partir das lacunas. Função pura, partilhada com o frontend.

import type {
  TaskDomain,
  TaskExecutor,
  TaskPhase,
  TaskPriority,
  TaskStatus,
} from '../models/domain.js';
import { addDays, isValidIsoDate } from '../utils/dates.js';
import { describeSources, type RequirementCode, type RequirementSource } from './requirements.js';
import type { RequirementEvaluation } from './stress-test-calculator.service.js';

export interface GeneratedTaskDraft {
  requirementCode: RequirementCode;
  requiredBy: readonly RequirementSource[];
  title: string;
  description: string;
  domain: TaskDomain;
  priority: TaskPriority;
  status: TaskStatus;
  executorType: TaskExecutor;
  phase: TaskPhase;
  includedInProposal: boolean;
  estimatedCost: number;
  deadline: string;
}

export class TaskGeneratorService {
  /**
   * @param gaps lacunas devolvidas pelo StressTestCalculatorService (já resolvidas por setor)
   * @param baseDate dia do diagnóstico (YYYY-MM-DD), a partir do qual contam os prazos
   */
  generate(gaps: readonly RequirementEvaluation[], baseDate: string): GeneratedTaskDraft[] {
    if (!isValidIsoDate(baseDate)) throw new RangeError(`Data base inválida: ${baseDate}`);

    return gaps.map(({ requirement, status, task }) => {
      if (status !== 'gap') throw new Error(`O requisito ${requirement.code} não é uma lacuna.`);
      // Sem remetente concreto não há tarefa (âmbito fechado).
      if (requirement.requiredBy.length === 0) {
        throw new Error(`O requisito ${requirement.code} não tem remetente (cliente, banco ou NIS2).`);
      }
      return {
        requirementCode: requirement.code,
        requiredBy: requirement.requiredBy,
        title: task.title,
        description: `${task.description}\n\nExigido por: ${describeSources(requirement.requiredBy)}.`,
        domain: task.domain,
        priority: task.priority,
        status: 'backlog',
        executorType: task.executorType,
        phase: task.phase,
        includedInProposal: true,
        estimatedCost: task.estimatedCost,
        deadline: addDays(baseDate, task.deadlineDays),
      };
    });
  }
}
