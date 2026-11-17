import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('título do separador', () => {
  it('cada ecrã tem o seu', () => {
    expect(pageTitle('/')).toBe('Stress Test de Qualificação · Plan4Sustain');
    expect(pageTitle('/entrar')).toBe('Entrar · Plan4Sustain');
    expect(pageTitle('/definir-palavra-passe')).toBe('Definir palavra-passe · Plan4Sustain');
    expect(pageTitle('/utilizadores')).toBe('Utilizadores · Plan4Sustain');
    expect(pageTitle('/documentos')).toBe('Documentos · Plan4Sustain');
  });

  it('os documentos levam o nome da empresa, com ou sem documento aberto', () => {
    expect(pageTitle('/documentos', 'Moldes Exemplo, Lda')).toBe('Documentos · Moldes Exemplo, Lda · Plan4Sustain');
    expect(pageTitle('/documentos/1d3ed713-b01c-4bc1-af10-9273711ed825', 'Moldes Exemplo, Lda')).toBe(
      'Documentos · Moldes Exemplo, Lda · Plan4Sustain',
    );
  });

  it('o plano leva o nome da empresa, com ou sem diagnóstico no endereço', () => {
    expect(pageTitle('/plano', 'Moldes Exemplo, Lda')).toBe('Plano de ação · Moldes Exemplo, Lda · Plan4Sustain');
    expect(pageTitle('/plano/1d3ed713-b01c-4bc1-af10-9273711ed825', 'Moldes Exemplo, Lda')).toBe(
      'Plano de ação · Moldes Exemplo, Lda · Plan4Sustain',
    );
  });

  it('sem empresa conhecida, o plano fica só com o nome do ecrã', () => {
    expect(pageTitle('/plano')).toBe('Plano de ação · Plan4Sustain');
    expect(pageTitle('/plano', null)).toBe('Plano de ação · Plan4Sustain');
  });

  it('o nome da empresa só aparece no plano e nos documentos', () => {
    expect(pageTitle('/', 'Moldes Exemplo, Lda')).toBe('Stress Test de Qualificação · Plan4Sustain');
    expect(pageTitle('/utilizadores', 'Moldes Exemplo, Lda')).toBe('Utilizadores · Plan4Sustain');
  });

  it('um endereço desconhecido fica com o título da página inicial, para onde é reencaminhado', () => {
    expect(pageTitle('/outra-coisa')).toBe('Stress Test de Qualificação · Plan4Sustain');
  });
});
