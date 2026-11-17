// Devolver o foco a quem o tinha, mesmo que a lista tenha sido redesenhada entretanto
// (um cartão do kanban que mudou de coluna deixa de ser o mesmo elemento).

export interface FocusOrigin {
  element: HTMLElement;
  /** Do mais próximo para o mais distante. Se o elemento desaparecer, o foco fica por perto. */
  ancestors: HTMLElement[];
  /** Controlos iguais que já existiam (duas tarefas com o mesmo título): não são o que procuramos. */
  twins: Set<HTMLElement>;
}

const CONTROLS = 'a[href], button, input, select, textarea, [tabindex]';

const canTakeFocus = (element: HTMLElement) =>
  element.isConnected && !element.matches(':disabled') && element.getClientRects().length > 0;

/** Controlos do mesmo tipo com o mesmo id, nome acessível ou texto. */
function lookalikes(origin: HTMLElement): HTMLElement[] {
  const label = origin.getAttribute('aria-label');
  const text = origin.textContent?.trim() ?? '';
  const matches = (candidate: HTMLElement) => {
    if (origin.id) return candidate.id === origin.id;
    if (label) return candidate.getAttribute('aria-label') === label;
    return text !== '' && candidate.textContent?.trim() === text;
  };
  return [...document.querySelectorAll<HTMLElement>(origin.tagName)].filter(
    (candidate) => candidate !== origin && matches(candidate),
  );
}

/** Quem tem o foco agora, para lho devolver mais tarde. Null se não está em nenhum controlo. */
export function captureFocus(): FocusOrigin | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || element === document.body) return null;
  const ancestors: HTMLElement[] = [];
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) ancestors.push(node);
  return { element, ancestors, twins: new Set(lookalikes(element)) };
}

/**
 * Por ordem: o próprio elemento; o mesmo controlo depois de redesenhado; o painel que o
 * continha, se aceitar o foco; o primeiro controlo do que restar à volta dele.
 */
function findTarget({ element, ancestors, twins }: FocusOrigin): HTMLElement | undefined {
  if (canTakeFocus(element)) return element;
  const candidates = lookalikes(element).filter(canTakeFocus);
  const redrawn = candidates.find((candidate) => !twins.has(candidate)) ?? candidates[0];
  if (redrawn) return redrawn;
  const alive = ancestors.filter((node) => node.isConnected);
  const container = alive.find((node) => node.tabIndex >= 0 && canTakeFocus(node));
  if (container) return container;
  for (const node of alive) {
    const inside = [...node.querySelectorAll<HTMLElement>(CONTROLS)].find(
      (candidate) => candidate.tabIndex >= 0 && canTakeFocus(candidate),
    );
    if (inside) return inside;
  }
  return undefined;
}

export function restoreFocus(origin: FocusOrigin | null): void {
  if (origin) findTarget(origin)?.focus();
}

/**
 * Para quando o elemento vai sair do ecrã com o foco lá dentro (um aviso que se fecha): o foco
 * passa para o primeiro controlo a seguir, em vez de voltar ao topo da página.
 */
export function focusAfter(element: Element): void {
  for (const candidate of document.querySelectorAll<HTMLElement>(CONTROLS)) {
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
