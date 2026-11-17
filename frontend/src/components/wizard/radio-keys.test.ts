import { describe, expect, it } from 'vitest';
import { radioKeyTarget } from './radio-keys';

describe('teclado de um grupo de opções', () => {
  it('seta para a direita ou para baixo vai à opção seguinte', () => {
    expect(radioKeyTarget('ArrowRight', 0, 4)).toBe(1);
    expect(radioKeyTarget('ArrowDown', 2, 4)).toBe(3);
  });

  it('seta para a esquerda ou para cima vai à anterior', () => {
    expect(radioKeyTarget('ArrowLeft', 3, 4)).toBe(2);
    expect(radioKeyTarget('ArrowUp', 1, 4)).toBe(0);
  });

  it('dá a volta nas pontas', () => {
    expect(radioKeyTarget('ArrowRight', 3, 4)).toBe(0);
    expect(radioKeyTarget('ArrowLeft', 0, 4)).toBe(3);
  });

  it('sem opção escolhida começa numa das pontas', () => {
    expect(radioKeyTarget('ArrowDown', -1, 4)).toBe(0);
    expect(radioKeyTarget('ArrowUp', -1, 4)).toBe(3);
  });

  it('com uma só opção fica nela', () => {
    expect(radioKeyTarget('ArrowRight', 0, 1)).toBe(0);
    expect(radioKeyTarget('ArrowLeft', 0, 1)).toBe(0);
  });

  it('as outras teclas não são do grupo', () => {
    for (const key of ['Tab', 'Enter', ' ', 'Home', 'End', 'a']) expect(radioKeyTarget(key, 1, 4)).toBeNull();
    expect(radioKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });
});
