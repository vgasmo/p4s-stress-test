/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Endereço de email de contacto da Plan4Sustain, definido no build por quem publica. Sem
   * ele, a página pública diz só que o diagnóstico completo é feito com a equipa.
   */
  readonly VITE_P4S_CONTACT_EMAIL?: string;
}
