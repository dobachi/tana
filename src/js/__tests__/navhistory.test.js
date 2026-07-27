import { describe, it, expect } from 'vitest';
import { createNavHistory } from '../core/navhistory.js';

describe('createNavHistory', () => {
  it('初期状態は空で戻れも進めもしない', () => {
    const h = createNavHistory();
    expect(h.current()).toBeNull();
    expect(h.canBack()).toBe(false);
    expect(h.canForward()).toBe(false);
    expect(h.back()).toBeNull();
    expect(h.forward()).toBeNull();
  });

  it('visit で積み、back/forward で行き来する', () => {
    const h = createNavHistory();
    h.visit('/a');
    h.visit('/b');
    h.visit('/c');
    expect(h.current()).toBe('/c');
    expect(h.back()).toBe('/b');
    expect(h.back()).toBe('/a');
    expect(h.canBack()).toBe(false);
    expect(h.forward()).toBe('/b');
    expect(h.forward()).toBe('/c');
    expect(h.canForward()).toBe(false);
  });

  it('同じ場所の連続 visit は積まない', () => {
    const h = createNavHistory();
    h.visit('/a');
    h.visit('/a');
    expect(h._state()).toEqual({ stack: ['/a'], idx: 0 });
  });

  it('戻った後に新しい場所へ行くと前方履歴は破棄される', () => {
    const h = createNavHistory();
    h.visit('/a');
    h.visit('/b');
    h.visit('/c');
    h.back(); // /b
    h.visit('/x'); // /c を捨てて /x
    expect(h._state()).toEqual({ stack: ['/a', '/b', '/x'], idx: 2 });
    expect(h.canForward()).toBe(false);
    expect(h.back()).toBe('/b');
  });

  it('空文字は無視する', () => {
    const h = createNavHistory();
    h.visit('');
    h.visit(null);
    expect(h.current()).toBeNull();
  });

  it('上限を超えると古い方から捨てる', () => {
    const h = createNavHistory(3);
    h.visit('/1');
    h.visit('/2');
    h.visit('/3');
    h.visit('/4');
    expect(h._state()).toEqual({ stack: ['/2', '/3', '/4'], idx: 2 });
  });
});
