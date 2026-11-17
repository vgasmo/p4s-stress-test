import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { looksGenerated } from '../../src/utils/secret-strength.js';

/** Bytes pseudo-aleatórios sempre iguais: a amostra é a mesma em todas as execuções. */
function sampleBytes(index: number, length: number): Buffer {
  const blocks = [0, 1].map((block) => createHash('sha256').update(`amostra-${index}-${block}`).digest());
  return Buffer.concat(blocks).subarray(0, length);
}

describe('looksGenerated (forma de um segredo gerado)', () => {
  it('aceita o que openssl rand e crypto.randomBytes produzem', () => {
    for (let i = 0; i < 500; i += 1) {
      for (const secret of [
        sampleBytes(i, 48).toString('base64'),
        sampleBytes(i, 48).toString('base64url'),
        sampleBytes(i, 32).toString('hex'),
        sampleBytes(i, 64).toString('hex'),
      ]) {
        expect(looksGenerated(secret), secret).toBe(true);
      }
    }
  });

  it('32 bytes em base64 também servem, desde que tenham maiúsculas, minúsculas e algarismos', () => {
    // Cerca de 1 em 1500 valores de 32 bytes não tem nenhum algarismo: gera-se outro.
    const accepted = Array.from({ length: 500 }, (_, i) => looksGenerated(sampleBytes(i, 32).toString('base64')));
    expect(accepted.filter(Boolean).length).toBeGreaterThanOrEqual(498);
  });

  it.each([
    ['um só carácter repetido', '0'.repeat(64)],
    ['o alfabeto', 'abcdefghijklmnopqrstuvwxyz123456'],
    ['o alfabeto completo, com maiúsculas e algarismos', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'],
    ['uma frase com hífenes', 'plan4sustain-leiria-2026-chave-da-api-jwt-de-producao'],
    ['uma frase com maiúsculas e algarismos', 'Plan4Sustain-Leiria-2026-Chave-Da-Api-Jwt-Producao'],
    ['uma frase com sublinhados', 'A_minha_chave_secreta_da_Plan4Sustain_em_2026_para_JWT'],
    ['um padrão curto repetido', 'aB3'.repeat(20)],
    ['hexadecimal repetido', 'deadbeef'.repeat(8)],
    ['hexadecimal em sequência', '0123456789abcdef'.repeat(4)],
    ['hexadecimal curto', randomBytes(16).toString('hex')],
    ['base64 curto', randomBytes(24).toString('base64')],
    ['o valor de exemplo antigo', 'um-segredo-de-desenvolvimento-com-32-caracteres'],
  ])('recusa %s', (_label, secret) => {
    expect(looksGenerated(secret)).toBe(false);
  });
});
