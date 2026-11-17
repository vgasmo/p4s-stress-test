// Gera o plano de ação a partir das lacunas. Função pura, partilhada com o frontend.

import type {
  TaskDomain,
  TaskExecutor,
  TaskPhase,
  TaskPriority,
  TaskStatus,
} from '../models/domain.js';
import { addDays, isValidIsoDate } from '../utils/dates.js';
import { describeSources, type RequirementCode, type RequirementSource } from './requirements.catalog.js';
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

    return gaps.map(({ rule, status, task }) => {
      if (status !== 'gap') throw new Error(`O requisito ${rule.code} não é uma lacuna.`);
      // Sem remetente concreto não há tarefa (âmbito fechado).
      if (rule.requiredBy.length === 0) {
        throw new Error(`O requisito ${rule.code} não tem remetente (cliente, banco ou NIS2).`);
      }
      return {
        requirementCode: rule.code,
        requiredBy: rule.requiredBy,
        title: task.title,
        description: `${task.description}\n\nExigido por: ${describeSources(rule.requiredBy)}.`,
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
