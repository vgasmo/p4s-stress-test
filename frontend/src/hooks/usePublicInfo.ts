import { useQuery } from '@tanstack/react-query';
import type { PublicInfo } from '@engine/models/api.types';
import { api } from '@/lib/api';
import { P4S_CONTACT_EMAIL, contactEmail } from '@/lib/contact';

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

/**
 * Contacto da P4S para quem ainda não tem conta. Vale o que está configurado no servidor
 * (P4S_CONTACT_EMAIL, que se muda sem recompilar) e, na falta dele, o indicado no build
 * (VITE_P4S_CONTACT_EMAIL). Null: a página não inventa contacto.
 */
export function useContactEmail(): string | null {
  return contactEmail(usePublicInfo().contactEmail) ?? P4S_CONTACT_EMAIL;
}
