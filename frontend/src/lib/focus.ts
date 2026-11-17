// Devolver o foco a quem o tinha, mesmo que a lista tenha sido redesenhada entretanto
// (um cartão do kanban que mudou de coluna deixa de ser o mesmo elemento).

export interface FocusOrigin {
  element: HTMLElement;
  /** Do mais próximo para o mais distante. Se o elemento desaparecer, o foco fica por perto. */
  ancestors: HTMLElement[];
}

/** Quem tem o foco agora, para lho devolver mais tarde. Null se não está em nenhum controlo. */
export function captureFocus(): FocusOrigin | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || element === document.body) return null;
  const ancestors: HTMLElement[] = [];
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) ancestors.push(node);
  return { element, ancestors };
}

const canTakeFocus = (element: HTMLElement) =>
  element.isConnected && !element.matches(':disabled') && element.getClientRects().length > 0;

/** O mesmo controlo depois de redesenhado: mesmo tipo e mesmo id, nome acessível ou texto. */
function findEquivalent(origin: HTMLElement): HTMLElement | null {
  const label = origin.getAttribute('aria-label');
  const text = origin.textContent?.trim() ?? '';
  const matches = (candidate: HTMLElement) => {
    if (origin.id) return candidate.id === origin.id;
    if (label) return candidate.getAttribute('aria-label') === label;
    return text !== '' && candidate.textContent?.trim() === text;
  };
  for (const candidate of document.querySelectorAll<HTMLElement>(origin.tagName)) {
    if (candidate !== origin && canTakeFocus(candidate) && matches(candidate)) return candidate;
  }
  return null;
}

export function restoreFocus(origin: FocusOrigin | null): void {
  if (!origin) return;
  const target = canTakeFocus(origin.element)
    ? origin.element
    : (findEquivalent(origin.element) ?? origin.ancestors.find((node) => node.tabIndex >= 0 && canTakeFocus(node)));
  target?.focus();
}

/**
 * Para quando o elemento vai sair do ecrã com o foco lá dentro (um aviso que se fecha): o foco
 * passa para o primeiro controlo a seguir, em vez de voltar ao topo da página.
 */
export function focusAfter(element: Element): void {
  const candidates = document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]');
  for (const candidate of candidates) {
    const follows = (element.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (follows && !element.contains(candidate) && candidate.tabIndex >= 0 && canTakeFocus(candidate)) {
      candidate.focus();
      return;
    }
  }
}

/**
 * Para alterações que redesenham a lista à volta do controlo usado. Se, depois de o ecrã ser
 * redesenhado, o foco tiver ficado sem dono, passa para o controlo equivalente.
 */
export function keepFocusAfterRedraw(): void {
  const origin = captureFocus();
  if (!origin) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body) restoreFocus(origin);
  });
}
