import { describe, it, expect } from 'vitest';
import {
  isPrefixLeader,
  resolvePrefixAction,
  prefixHint,
  PREFIX_LEADERS,
} from '../core/keyprefix.js';

describe('isPrefixLeader', () => {
  it('s/t/y/o がリーダー（大小無視）', () => {
    for (const k of ['s', 't', 'y', 'o', 'S', 'T']) expect(isPrefixLeader(k)).toBe(true);
  });
  it('それ以外や非文字列は false', () => {
    expect(isPrefixLeader('a')).toBe(false);
    expect(isPrefixLeader('Enter')).toBe(false);
    expect(isPrefixLeader(null)).toBe(false);
  });
  it('PREFIX_LEADERS の全キーがリーダー判定される', () => {
    for (const k of Object.keys(PREFIX_LEADERS)) expect(isPrefixLeader(k)).toBe(true);
  });
});

describe('resolvePrefixAction', () => {
  it('sort', () => {
    expect(resolvePrefixAction('s', 'n')).toBe('sort:name');
    expect(resolvePrefixAction('s', 's')).toBe('sort:size');
    expect(resolvePrefixAction('s', 'm')).toBe('sort:modified');
    expect(resolvePrefixAction('s', 'e')).toBe('sort:ext');
    expect(resolvePrefixAction('s', 'r')).toBe('sort:reverse');
  });
  it('tab / copy / open', () => {
    expect(resolvePrefixAction('t', 'h')).toBe('tab:left');
    expect(resolvePrefixAction('t', 'l')).toBe('tab:right');
    expect(resolvePrefixAction('y', 'p')).toBe('copy:path');
    expect(resolvePrefixAction('y', 'n')).toBe('copy:name');
    expect(resolvePrefixAction('y', 'd')).toBe('copy:dir');
    expect(resolvePrefixAction('o', 'o')).toBe('open:app');
    expect(resolvePrefixAction('o', 'r')).toBe('open:reveal');
  });
  it('大文字キーも解決する', () => {
    expect(resolvePrefixAction('t', 'H')).toBe('tab:left');
  });
  it('未対応の組み合わせ・不正入力は null', () => {
    expect(resolvePrefixAction('t', 'x')).toBeNull();
    expect(resolvePrefixAction('z', 'h')).toBeNull();
    expect(resolvePrefixAction('y', 42)).toBeNull();
  });
});

describe('prefixHint', () => {
  it('各リーダーに文言がある', () => {
    for (const k of Object.keys(PREFIX_LEADERS)) expect(prefixHint(k)).toBeTruthy();
    expect(prefixHint('z')).toBe('');
  });
});
