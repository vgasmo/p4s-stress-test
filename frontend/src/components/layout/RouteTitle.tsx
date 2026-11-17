import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useMe } from '@/hooks/useAuth';
import { pageTitle } from '@/lib/page-title';

/** Mantém o título do separador igual ao ecrã aberto (ver lib/page-title.ts). */
export function RouteTitle() {
  const { pathname } = useLocation();
  const companyName = useMe().data?.company?.name;
  useEffect(() => {
    document.title = pageTitle(pathname, companyName);
  }, [pathname, companyName]);
  return null;
}
