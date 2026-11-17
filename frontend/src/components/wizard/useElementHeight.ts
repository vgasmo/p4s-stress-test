import { useCallback, useLayoutEffect, useState } from 'react';

/** Altura de um elemento, acompanhada enquanto ele existir (0 sem elemento). */
function useObservedHeight(element: Element | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!element) {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(Math.round(element.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

/**
 * Altura do cabeçalho fixo da aplicação. Muda com a largura (em ecrãs estreitos parte-se em
 * duas linhas), por isso quem prende alguma coisa logo abaixo dele, ou não quer um controlo
 * com foco tapado por ele, tem de a medir.
 */
export function useAppHeaderHeight(): number {
  const [header, setHeader] = useState<Element | null>(null);
  useLayoutEffect(() => setHeader(document.querySelector('[data-app-shell] > header')), []);
  return useObservedHeight(header);
}

/** Altura de um elemento do próprio ecrã: devolve a ref a pôr no elemento e a medida. */
export function useElementHeight<T extends Element>(): [(element: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((next: T | null) => setElement(next), []);
  return [ref, useObservedHeight(element)];
}
