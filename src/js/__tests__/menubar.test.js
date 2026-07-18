import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initMenuBar,
  isMenuBarVisible,
  setMenuBarVisible,
  toggleMenuBar,
  getStoredMenuBarVisible,
} from '../core/menubar.js';
import { showMenu, closeMenu } from '../core/menu.js';

let bar;

beforeEach(() => {
  localStorage.clear();
  bar = document.createElement('div');
  document.body.appendChild(bar);
});

afterEach(() => {
  closeMenu();
  bar.remove();
  document.body.innerHTML = '';
});

const MENUS = [
  { label: 'ファイル', items: [{ label: '終了', action: vi.fn() }] },
  { label: '表示', items: () => [{ label: '隠しファイル', action: vi.fn() }] },
];

describe('initMenuBar', () => {
  it('トップレベルのメニューをボタンとして並べる', () => {
    initMenuBar(bar, MENUS);
    const labels = [...bar.querySelectorAll('.menu-bar-item')].map((b) => b.textContent);
    expect(labels).toEqual(['ファイル', '表示']);
  });

  // 既定を「表示」にしているのは、メニューバー自体がショートカットを
  // 知らない人のための入口だから（隠れていては目的を果たさない）。
  it('既定では表示（保存値が無いとき）', () => {
    initMenuBar(bar, MENUS);
    expect(isMenuBarVisible()).toBe(true);
    expect(bar.classList.contains('hidden')).toBe(false);
  });

  it('明示的に隠した選択は維持される', () => {
    localStorage.setItem('tana.menuBarVisible', '0');
    initMenuBar(bar, MENUS);
    expect(isMenuBarVisible()).toBe(false);
  });

  it('保存済みの表示状態を復元する', () => {
    localStorage.setItem('tana.menuBarVisible', '1');
    initMenuBar(bar, MENUS);
    expect(isMenuBarVisible()).toBe(true);
  });

  it('再初期化で中身が重複しない', () => {
    initMenuBar(bar, MENUS);
    initMenuBar(bar, MENUS);
    expect(bar.querySelectorAll('.menu-bar-item')).toHaveLength(2);
  });
});

describe('表示/非表示の切り替え', () => {
  beforeEach(() => initMenuBar(bar, MENUS));

  it('toggleMenuBar で反転し、localStorage に永続化する', () => {
    toggleMenuBar();
    expect(isMenuBarVisible()).toBe(false);
    expect(getStoredMenuBarVisible()).toBe(false);

    toggleMenuBar();
    expect(isMenuBarVisible()).toBe(true);
    expect(getStoredMenuBarVisible()).toBe(true);
  });

  it('非表示にすると開いているドロップダウンも閉じる', () => {
    setMenuBarVisible(true);
    bar.querySelectorAll('.menu-bar-item')[0].click();
    expect(document.querySelector('.context-menu')).toBeTruthy();

    setMenuBarVisible(false);
    expect(document.querySelector('.context-menu')).toBeNull();
  });
});

describe('ドロップダウンの開閉', () => {
  beforeEach(() => {
    initMenuBar(bar, MENUS);
    setMenuBarVisible(true);
  });

  it('クリックで開き、同じメニューの再クリックで閉じる', () => {
    const btn = bar.querySelectorAll('.menu-bar-item')[0];
    btn.click();
    expect(document.querySelector('.context-menu')).toBeTruthy();
    expect(btn.classList.contains('open')).toBe(true);

    btn.click();
    expect(document.querySelector('.context-menu')).toBeNull();
    expect(btn.classList.contains('open')).toBe(false);
  });

  it('開いている状態で別のメニューにホバーすると切り替わる', () => {
    const [file, view] = bar.querySelectorAll('.menu-bar-item');
    file.click();
    view.dispatchEvent(new MouseEvent('mouseenter'));
    expect(view.classList.contains('open')).toBe(true);
    expect(file.classList.contains('open')).toBe(false);
  });

  it('閉じている状態でのホバーでは開かない', () => {
    const view = bar.querySelectorAll('.menu-bar-item')[1];
    view.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('items が関数のメニューは開くたびに評価される（状態を反映できる）', () => {
    let count = 0;
    initMenuBar(bar, [
      {
        label: '表示',
        items: () => {
          count += 1;
          return [{ label: `呼び出し${count}回目`, action: vi.fn() }];
        },
      },
    ]);
    setMenuBarVisible(true);
    const btn = bar.querySelector('.menu-bar-item');
    btn.click();
    expect(document.querySelector('.context-menu-label').textContent).toBe('呼び出し1回目');
    btn.click(); // 閉じる
    btn.click(); // 開き直す
    expect(document.querySelector('.context-menu-label').textContent).toBe('呼び出し2回目');
  });
});

describe('showMenu', () => {
  afterEach(closeMenu);

  it('ラベルとショートカットを描画する', () => {
    showMenu(10, 10, [{ label: '設定…', shortcut: 'Ctrl+,', action: vi.fn() }]);
    expect(document.querySelector('.context-menu-label').textContent).toBe('設定…');
    expect(document.querySelector('.context-menu-shortcut').textContent).toBe('Ctrl+,');
  });

  it('区切りを描画する', () => {
    showMenu(10, 10, [{ label: 'A', action: vi.fn() }, { separator: true }, { label: 'B' }]);
    expect(document.querySelectorAll('.context-menu-sep')).toHaveLength(1);
  });

  it('選択すると action を呼んで閉じる', () => {
    const action = vi.fn();
    showMenu(10, 10, [{ label: 'A', action }]);
    document.querySelector('.context-menu-item').click();
    expect(action).toHaveBeenCalled();
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('Escape で閉じる', () => {
    showMenu(10, 10, [{ label: 'A', action: vi.fn() }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('action が投げても閉じる（メニューが残らない）', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    showMenu(10, 10, [
      {
        label: 'A',
        action: () => {
          throw new Error('boom');
        },
      },
    ]);
    document.querySelector('.context-menu-item').click();
    expect(document.querySelector('.context-menu')).toBeNull();
    err.mockRestore();
  });
});
