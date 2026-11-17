const DEFAULT_NEXT = '/plano';

/**
 * Destino depois do login. Só aceita caminhos internos: começa por uma só barra e não leva
 * espaços, caracteres de controlo nem barras invertidas. Evita redirecionamentos para fora
 * e destinos que o router recusa (e que deixavam a página em branco).
 */
export function safeNext(value: string | null, origin: string): string {
  if (!value || !/^\/(?!\/)[\x21-\x7E]*$/.test(value) || value.includes('\\')) return DEFAULT_NEXT;
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
}
