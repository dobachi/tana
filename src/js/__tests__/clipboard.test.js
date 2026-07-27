import { describe, it, expect } from 'vitest';
import { createFileClipboard } from '../core/clipboard.js';

const A = { path: '/a.txt', name: 'a.txt' };
const B = { path: '/b.txt', name: 'b.txt' };

describe('createFileClipboard', () => {
  it('初期状態は空', () => {
    const cb = createFileClipboard();
    expect(cb.isEmpty()).toBe(true);
    expect(cb.count()).toBe(0);
    expect(cb.get()).toEqual({ op: null, entries: [] });
  });

  it('copy は op=copy で登録する', () => {
    const cb = createFileClipboard();
    cb.copy([A, B]);
    expect(cb.isEmpty()).toBe(false);
    expect(cb.count()).toBe(2);
    expect(cb.get()).toEqual({ op: 'copy', entries: [A, B] });
  });

  it('cut は op=move で登録する', () => {
    const cb = createFileClipboard();
    cb.cut(A);
    expect(cb.get()).toEqual({ op: 'move', entries: [A] });
  });

  it('単体エントリも配列として正規化する', () => {
    const cb = createFileClipboard();
    cb.copy(A);
    expect(cb.get().entries).toEqual([A]);
  });

  it('path を持たない要素は除外する', () => {
    const cb = createFileClipboard();
    cb.copy([A, null, {}, { name: 'x' }, B]);
    expect(cb.get().entries).toEqual([A, B]);
  });

  it('空の登録はクリップボードなしに倒す', () => {
    const cb = createFileClipboard();
    cb.copy(A);
    cb.copy([]);
    expect(cb.isEmpty()).toBe(true);
    expect(cb.get()).toEqual({ op: null, entries: [] });
  });

  it('clear で空に戻す', () => {
    const cb = createFileClipboard();
    cb.cut([A, B]);
    cb.clear();
    expect(cb.isEmpty()).toBe(true);
    expect(cb.get()).toEqual({ op: null, entries: [] });
  });

  it('get の entries は複製で、外から変更しても内部に影響しない', () => {
    const cb = createFileClipboard();
    cb.copy([A, B]);
    const snap = cb.get();
    snap.entries.push(A);
    expect(cb.count()).toBe(2);
  });
});
