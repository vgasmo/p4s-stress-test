import { useQuery } from '@tanstack/react-query';
import type { PublicInfo } from '@engine/models/api.types';
import { api } from '@/lib/api';

const NOTHING_CONFIGURED: PublicInfo = { contactEmail: null, legalIdentity: null, proposalTerms: [] };

/**
 * Contacto e condições da proposta que a P4S configurou no servidor. Se o pedido falhar, a
 * aplicação comporta-se como se nada estivesse configurado: são textos acessórios.
 */
export function usePublicInfo(): PublicInfo {
  const query = useQuery({
    queryKey: ['public-info'],
    queryFn: api.getPublicInfo,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return query.data ?? NOTHING_CONFIGURED;
}
