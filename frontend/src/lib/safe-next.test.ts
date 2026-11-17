import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

const ORIGIN = 'https://stress-test.example';

describe('destino depois do login', () => {
  it.each([
    ['/plano', '/plano'],
    ['/', '/'],
    ['/plano/8d6e7177-8706-4389-aded-5b5cb5fd9142', '/plano/8d6e7177-8706-4389-aded-5b5cb5fd9142'],
    ['/utilizadores?x=1#topo', '/utilizadores?x=1#topo'],
  ])('aceita o caminho interno %s', (value, expected) => {
    expect(safeNext(value, ORIGIN)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['plano'],
    ['//example.com'],
    ['https://example.com/plano'],
    ['/\\example.com'],
    ['/\t/example.com'],
    ['/\n/example.com'],
    ['/\r/example.com'],
    ['/ plano'],
    ['javascript:alert(1)'],
  ])('recusa %j e vai para o plano', (value) => {
    expect(safeNext(value, ORIGIN)).toBe('/plano');
  });

  it('normaliza os segmentos «..» sem sair da origem', () => {
    expect(safeNext('/plano/../../outra', ORIGIN)).toBe('/outra');
  });
});
