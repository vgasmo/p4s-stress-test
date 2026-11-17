// Contacto da Plan4Sustain para quem ainda não tem conta.
//
// O endereço não está no código: vem de VITE_P4S_CONTACT_EMAIL, definido no build por quem
// publica. Sem endereço, ou com um que não tenha forma de endereço de email, a página não
// inventa contacto: diz só que o diagnóstico completo é feito com a equipa Plan4Sustain.
// As funções são puras, para se poderem testar.

/**
 * Só letras, algarismos e os sinais comuns: assim o endereço vai para a ligação mailto: tal
 * como está, sem codificação que alguns programas de email não desfazem.
 */
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** Endereço de contacto configurado. Null se faltar ou não tiver forma de endereço de email. */
export function contactEmail(configured: unknown): string | null {
  if (typeof configured !== 'string') return null;
  const email = configured.trim();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** O que o visitante simulou, para a equipa saber de que fábrica se trata. Textos já formatados. */
export interface SimulationSummary {
  sector: string;
  annualRevenue: string;
  topClientsShare: string;
  /** Faturação comercial em risco. Null enquanto não houver resultado. */
  atRisk: string | null;
}

export const DIAGNOSIS_REQUEST_SUBJECT = 'Pedido de diagnóstico completo';

/**
 * Ligação mailto: para pedir o diagnóstico completo, com o assunto preenchido e uma mensagem
 * que o visitante só tem de completar. Com uma simulação feita, leva o resumo dela.
 */
export function diagnosisRequestMailto(email: string, simulation?: SimulationSummary): string {
  const lines = [
    'Gostaria de pedir o diagnóstico completo da minha empresa.',
    '',
    'Empresa:',
    'NIF:',
    'Nome e telefone de contacto:',
  ];
  if (simulation) {
    lines.push(
      '',
      'Simulação feita no stress test',
      `Perfil setorial: ${simulation.sector}`,
      `Faturação anual: ${simulation.annualRevenue}`,
      `Concentração nos 3 maiores clientes: ${simulation.topClientsShare}`,
    );
    if (simulation.atRisk) lines.push(`Faturação comercial em risco: ${simulation.atRisk}`);
  }
  // Os valores formatados trazem espaços que não partem linha: numa mensagem de texto são espaços normais.
  const body = lines.join('\r\n').replace(/ /g, ' ');
  return `mailto:${email}?subject=${encodeURIComponent(DIAGNOSIS_REQUEST_SUBJECT)}&body=${encodeURIComponent(body)}`;
}

/** Endereço de contacto deste build. */
export const P4S_CONTACT_EMAIL = contactEmail(import.meta.env.VITE_P4S_CONTACT_EMAIL);
