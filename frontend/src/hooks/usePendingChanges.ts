import { useIsMutating, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { savedTaskReads } from './useTasks';

const settled = (queryClient: QueryClient) => queryClient.isMutating() === 0 && savedTaskReads.inFlight() === 0;

/** Resolve quando já não há alterações à espera do servidor: ficaram gravadas ou foram desfeitas. */
export function whenChangesSettle(queryClient: QueryClient): Promise<void> {
  return new Promise((resolve) => {
    if (settled(queryClient)) {
      resolve();
      return;
    }
    const check = () => {
      if (!settled(queryClient)) return;
      stopMutations();
      stopReads();
      resolve();
    };
    const stopMutations = queryClient.getMutationCache().subscribe(check);
    const stopReads = savedTaskReads.subscribe(check);
  });
}

export interface PendingChanges {
  /** Há alterações que o servidor ainda não confirmou. O ecrã já as mostra. */
  pending: boolean;
  count: number;
  /** Para esperar por elas antes de exportar ou imprimir o que está no ecrã. */
  whenSettled: () => Promise<void>;
}

/**
 * Alterações ainda por confirmar pelo servidor, em toda a aplicação. O plano muda no ecrã antes
 * da resposta. Quem exporta o resumo espera por `whenSettled`, para o documento sair só com o
 * que ficou gravado (uma alteração que falhe é desfeita no ecrã).
 */
export function usePendingChanges(): PendingChanges {
  const queryClient = useQueryClient();
  const mutating = useIsMutating();
  const confirming = useSyncExternalStore(savedTaskReads.subscribe, savedTaskReads.inFlight);
  const whenSettled = useCallback(() => whenChangesSettle(queryClient), [queryClient]);
  const count = mutating + confirming;
  return { pending: count > 0, count, whenSettled };
}
