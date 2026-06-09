import { describe, it, expect, beforeEach } from 'vitest';
import { createHelp, SHORTCUTS } from '../core/help.js';

describe('help', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('toggle で開閉する', () => {
    const help = createHelp(document);
    expect(help.isOpen()).toBe(false);
    help.toggle();
    expect(help.isOpen()).toBe(true);
    expect(document.querySelector('.help-overlay')).not.toBeNull();
    help.toggle();
    expect(help.isOpen()).toBe(false);
    expect(document.querySelector('.help-overlay')).toBeNull();
  });

  it('全セクションとショートカット項目を表示する', () => {
    const help = createHelp(document);
    help.open();
    const sections = document.querySelectorAll('.help-section');
    expect(sections).toHaveLength(SHORTCUTS.length);
    const items = document.querySelectorAll('.help-list dt');
    const total = SHORTCUTS.reduce((n, s) => n + s.items.length, 0);
    expect(items).toHaveLength(total);
    // 代表的なショートカットが含まれる
    const keys = [...items].map((dt) => dt.textContent);
    expect(keys).toContain('F5');
    expect(keys).toContain('Ctrl + Shift + Space');
  });

  it('open を二重に呼んでもオーバーレイは1つ', () => {
    const help = createHelp(document);
    help.open();
    help.open();
    expect(document.querySelectorAll('.help-overlay')).toHaveLength(1);
  });

  it('Escape で閉じる', () => {
    const help = createHelp(document);
    help.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(help.isOpen()).toBe(false);
  });

  it('doc が無ければ何もしない', () => {
    const help = createHelp(null);
    expect(() => help.toggle()).not.toThrow();
    expect(help.isOpen()).toBe(false);
  });
});
