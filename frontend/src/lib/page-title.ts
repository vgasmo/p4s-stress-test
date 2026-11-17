// Título do separador por ecrã: é o que distingue os separadores abertos, o que o leitor de
// ecrã anuncia ao mudar de página e o nome proposto para o PDF do resumo.

const SITE = 'Plan4Sustain';

export function pageTitle(pathname: string, companyName?: string | null): string {
  const page = pathname.startsWith('/plano')
    ? ['Plano de ação', ...(companyName ? [companyName] : [])]
    : pathname === '/entrar'
      ? ['Entrar']
      : pathname === '/definir-palavra-passe'
        ? ['Definir palavra-passe']
        : pathname === '/utilizadores'
          ? ['Utilizadores']
          : pathname.startsWith('/documentos')
            ? ['Documentos', ...(companyName ? [companyName] : [])]
            : ['Stress Test de Qualificação'];
  return [...page, SITE].join(' · ');
}
