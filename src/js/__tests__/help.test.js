import { describe, it, expect, beforeEach } from 'vitest';
import { createHelp, SHORTCUTS, filterShortcuts } from '../core/help.js';

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
    expect(keys).toContain('F5 / F6');
    expect(keys).toContain('Ctrl + Shift + Space');
    // コンテキストメニュー専用の操作（ファイルマネージャで表示・パス/名前コピー）に
    // キーボードから到達できるよう、その開き方を必ず載せる (FR-10)。
    expect(keys).toContain('Shift + F10 / ≣');
    // ファイルクリップボード（任意の現在地へ貼り付け）(FR-02)
    expect(keys).toContain('Ctrl + V');
  });

  it('パスを直接開く Ctrl+L は「移動」の節にある', () => {
    const move = SHORTCUTS.find((s) => s.section === '移動');
    expect(move.items.map(([k]) => k)).toContain('Ctrl + L');
  });

  it('× ボタンで閉じる', () => {
    const help = createHelp(document);
    help.open();
    document.querySelector('.help-overlay .modal-close').click();
    expect(help.isOpen()).toBe(false);
  });

  it('版を見出しに出す', () => {
    const help = createHelp(document);
    help.setVersion('1.2.3');
    help.open();
    expect(document.querySelector('.help-title').textContent).toContain('v1.2.3');
  });

  it('開くと絞り込み欄にフォーカスし、打った語で一覧を絞る', () => {
    const help = createHelp(document);
    help.open();
    const input = document.querySelector('.help-filter');
    expect(document.activeElement).toBe(input);
    input.value = 'ctrl+l';
    input.dispatchEvent(new Event('input'));
    const keys = [...document.querySelectorAll('.help-list dt')].map((d) => d.textContent);
    expect(keys).toContain('Ctrl + L');
    expect(keys).not.toContain('F2');
    input.value = 'zzzzz';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.help-empty')).not.toBeNull();
  });

  it('絞り込み中の Esc は語を消すだけ。もう一度で閉じる', () => {
    const help = createHelp(document);
    help.open();
    const input = document.querySelector('.help-filter');
    input.value = 'パス';
    input.dispatchEvent(new Event('input'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(help.isOpen()).toBe(true);
    expect(input.value).toBe('');
    const total = SHORTCUTS.reduce((n, s) => n + s.items.length, 0);
    expect(document.querySelectorAll('.help-list dt')).toHaveLength(total);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(help.isOpen()).toBe(false);
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

describe('filterShortcuts', () => {
  const data = [
    {
      section: '移動',
      items: [
        ['Ctrl + L', 'パスを入力して移動'],
        ['h', '親フォルダへ'],
      ],
    },
    { section: '表示', items: [['Ctrl + P', 'プレビュー']] },
  ];

  it('空の語ならそのまま', () => {
    expect(filterShortcuts(data, '  ')).toBe(data);
  });

  it('説明・キーで絞り、空になった節は消す', () => {
    expect(filterShortcuts(data, 'パス')).toEqual([
      { section: '移動', items: [['Ctrl + L', 'パスを入力して移動']] },
    ]);
    expect(filterShortcuts(data, 'CTRL+P')).toEqual([
      { section: '表示', items: [['Ctrl + P', 'プレビュー']] },
    ]);
  });

  it('見出しに合えば節ごと残す。語はすべて含むものだけ', () => {
    expect(filterShortcuts(data, '移動')[0].items).toHaveLength(2);
    expect(filterShortcuts(data, '移動 親')[0].items).toEqual([['h', '親フォルダへ']]);
    expect(filterShortcuts(data, 'パス　プレビュー')).toEqual([]); // 全角空白も区切り
  });
});
