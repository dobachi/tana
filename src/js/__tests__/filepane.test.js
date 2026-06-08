import { describe, it, expect } from 'vitest';
import { formatSize, clampCursor, isHidden, filterEntries } from '../core/filepane.js';

describe('formatSize', () => {
  it('0 や負値は空文字', () => {
    expect(formatSize(0)).toBe('');
    expect(formatSize(-5)).toBe('');
  });
  it('バイト〜GBを単位付きで返す', () => {
    expect(formatSize(512)).toBe('512B');
    expect(formatSize(1024)).toBe('1.0KB');
    expect(formatSize(1536)).toBe('1.5KB');
    expect(formatSize(1048576)).toBe('1.0MB');
    expect(formatSize(1073741824)).toBe('1.0GB');
  });
});

describe('clampCursor', () => {
  it('空リストは 0', () => {
    expect(clampCursor(3, 0)).toBe(0);
  });
  it('範囲内はそのまま', () => {
    expect(clampCursor(2, 5)).toBe(2);
  });
  it('下限・上限でクランプ', () => {
    expect(clampCursor(-1, 5)).toBe(0);
    expect(clampCursor(9, 5)).toBe(4);
  });
});

describe('isHidden', () => {
  it('バックエンドの is_hidden を優先する', () => {
    expect(isHidden({ name: 'visible', is_hidden: true })).toBe(true);
    expect(isHidden({ name: '.env', is_hidden: false })).toBe(false);
  });
  it('is_hidden 不在時は先頭ドットで判定', () => {
    expect(isHidden({ name: '.gitignore' })).toBe(true);
    expect(isHidden({ name: 'README.md' })).toBe(false);
  });
});

describe('filterEntries', () => {
  const entries = [
    { name: '.git', is_hidden: true },
    { name: 'src', is_hidden: false },
    { name: '.env', is_hidden: true },
    { name: 'README.md', is_hidden: false },
  ];
  it('showHidden=false で隠しを除外', () => {
    expect(filterEntries(entries, false).map((e) => e.name)).toEqual(['src', 'README.md']);
  });
  it('showHidden=true で全件', () => {
    expect(filterEntries(entries, true)).toHaveLength(4);
  });
});
