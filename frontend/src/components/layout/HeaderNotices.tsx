import { WifiOff } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Notice } from './Notice';

const SLOT_ID = 'header-notices';

/**
 * Avisos por baixo da barra do topo, dentro do cabeçalho fixo, para ficarem à vista em qualquer
 * ponto da página. Leva o aviso de falta de ligação e os que a moldura aqui puser com HeaderNotice.
 */
export function HeaderNotices() {
  const online = useOnlineStatus();
  const box = useRef<HTMLDivElement>(null);

  // A altura do cabeçalho fixo fica numa variável CSS, que o scroll-padding usa (index.css)
  // para o elemento focado nunca ficar por baixo dele.
  useLayoutEffect(() => {
    const header = box.current?.closest('header');
    if (!header) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--app-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--app-header-height');
    };
  }, []);

  return (
    <div ref={box} className="mx-auto max-w-[1400px] px-4 sm:px-6 [&>*]:mb-2">
      {!online && (
        <Notice tone="warning" role="status" icon={WifiOff} title="Sem ligação à internet." testId="connection-notice">
          <p className="text-xs text-amber-900">As alterações não ficam guardadas até a ligação voltar.</p>
        </Notice>
      )}
      <div id={SLOT_ID} className="space-y-2 empty:hidden" />
    </div>
  );
}

/** Põe um aviso na zona do cabeçalho. Numa página sem essa zona, o aviso fica onde foi escrito. */
export function HeaderNotice({ children }: { children: ReactNode }) {
  const [slot] = useState(() => document.getElementById(SLOT_ID));
  return slot ? createPortal(children, slot) : <>{children}</>;
}
