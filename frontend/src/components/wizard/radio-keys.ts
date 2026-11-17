// Teclado de um grupo de opções exclusivas (role="radiogroup"): as setas mudam de opção e
// dão a volta no fim. Função pura, para se poder testar sem browser.

/**
 * Posição da opção para onde a tecla leva, a partir da opção em `current` (-1: nenhuma).
 * Null se a tecla não for do grupo.
 */
export function radioKeyTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  return null;
}
