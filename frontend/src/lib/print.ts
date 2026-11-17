/**
 * Abre a janela de impressão com um título próprio. O browser usa o título da página como
 * nome por omissão do PDF: assim cada resumo sai com o nome da empresa e a data, em vez de
 * todos se chamarem o mesmo.
 */
export function printWithTitle(title: string): void {
  const previous = document.title;
  const restore = () => {
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  document.title = title;
  window.print();
}
