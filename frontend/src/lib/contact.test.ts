import { describe, expect, it } from 'vitest';
import { DIAGNOSIS_REQUEST_SUBJECT, contactEmail, diagnosisRequestMailto } from './contact';

describe('endereço de contacto configurado no build', () => {
  it('aceita um endereço de email, sem os espaços à volta', () => {
    expect(contactEmail('diagnostico@exemplo.pt')).toBe('diagnostico@exemplo.pt');
    expect(contactEmail('  equipa.comercial+site@sub.exemplo.com \n')).toBe('equipa.comercial+site@sub.exemplo.com');
  });

  it.each([
    ['por definir', undefined],
    ['vazio', ''],
    ['só espaços', '   '],
    ['que não é texto', 42],
    ['sem arroba', 'exemplo.pt'],
    ['sem domínio', 'equipa@'],
    ['com o domínio sem ponto', 'equipa@exemplo'],
    ['com nome à frente', 'Equipa <equipa@exemplo.pt>'],
    ['dois endereços', 'a@exemplo.pt, b@exemplo.pt'],
    ['com parâmetros de mailto', 'equipa@exemplo.pt?cc=outro@exemplo.pt'],
    ['com espaços no meio', 'equipa @exemplo.pt'],
    ['com percentagem', 'equipa%40x@exemplo.pt'],
    ['demasiado comprido', `${'a'.repeat(250)}@exemplo.pt`],
  ])('sem contacto se o valor vier %s', (_label, configured) => {
    expect(contactEmail(configured)).toBeNull();
  });
});

describe('ligação para pedir o diagnóstico completo', () => {
  const parts = (href: string) => {
    const [address = '', query = ''] = href.replace(/^mailto:/, '').split('?');
    const params = new URLSearchParams(query.replaceAll('+', '%2B'));
    return { address, subject: params.get('subject'), body: params.get('body') };
  };

  it('abre uma mensagem para o endereço, com o assunto preenchido', () => {
    const href = diagnosisRequestMailto('diagnostico@exemplo.pt');
    expect(href.startsWith('mailto:diagnostico@exemplo.pt?subject=')).toBe(true);
    expect(parts(href)).toMatchObject({ address: 'diagnostico@exemplo.pt', subject: DIAGNOSIS_REQUEST_SUBJECT });
  });

  it('o assunto e a mensagem vão codificados, sem espaços nem quebras de linha por tratar', () => {
    const href = diagnosisRequestMailto('diagnostico@exemplo.pt');
    expect(href).not.toMatch(/[\s ]/);
    expect(href).toContain('subject=Pedido%20de%20diagn%C3%B3stico%20completo');
    expect(href).toContain('%0D%0A');
  });

  it('a mensagem pede os dados de que a equipa precisa para responder', () => {
    const { body } = parts(diagnosisRequestMailto('diagnostico@exemplo.pt'));
    expect(body?.split('\r\n')).toEqual([
      'Gostaria de pedir o diagnóstico completo da minha empresa.',
      '',
      'Empresa:',
      'NIF:',
      'Nome e telefone de contacto:',
    ]);
  });

  it('com uma simulação feita, leva o resumo dela, em texto simples', () => {
    const { body } = parts(
      diagnosisRequestMailto('diagnostico@exemplo.pt', {
        sector: 'Moldes e componentes automóvel',
        annualRevenue: '6.500.000 €',
        topClientsShare: '60%',
        atRisk: '2,3 M € a 3,1 M €',
      }),
    );
    expect(body?.split('\r\n').slice(5)).toEqual([
      '',
      'Simulação feita no stress test',
      'Perfil setorial: Moldes e componentes automóvel',
      'Faturação anual: 6.500.000 €',
      'Concentração nos 3 maiores clientes: 60%',
      'Faturação comercial em risco: 2,3 M € a 3,1 M €',
    ]);
  });

  it('sem resultado ainda, o resumo vai sem a faturação em risco', () => {
    const { body } = parts(
      diagnosisRequestMailto('diagnostico@exemplo.pt', { sector: 'Indústria de processo', annualRevenue: '5.000.000 €', topClientsShare: '40%', atRisk: null }),
    );
    expect(body).toContain('Concentração nos 3 maiores clientes: 40%');
    expect(body).not.toContain('Faturação comercial em risco');
  });
});
