import { describe, it, expect, afterEach, vi } from 'vitest';
import { showMenu, closeMenu, isMenuVisible } from '../core/menu.js';

afterEach(() => {
  closeMenu();
  document.body.innerHTML = '';
});

function labelOfActive() {
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('context-menu-item')) return null;
  return el.querySelector('.context-menu-label').textContent;
}

describe('showMenu', () => {
  it('表示すると isMenuVisible が true、閉じると false', () => {
    showMenu(0, 0, [{ label: 'A', action: vi.fn() }]);
    expect(isMenuVisible()).toBe(true);
    closeMenu();
    expect(isMenuVisible()).toBe(false);
  });

  it('focusFirst で先頭の「有効な」項目にフォーカスする（区切り・無効を飛ばす）', () => {
    // キーボード（Shift+F10 等）から開いたときの経路。マウスと違い
    // ポインタが項目上に無いので、先頭項目へフォーカスして即操作できるようにする。
    showMenu(
      0,
      0,
      [
        { separator: true },
        { label: '無効', action: vi.fn(), disabled: true },
        { label: 'B', action: vi.fn() },
        { label: 'C', action: vi.fn() },
      ],
      { focusFirst: true },
    );
    expect(labelOfActive()).toBe('B');
  });

  it('focusFirst 無指定（マウス経路）ではどの項目にもフォーカスしない', () => {
    showMenu(0, 0, [
      { label: 'A', action: vi.fn() },
      { label: 'B', action: vi.fn() },
    ]);
    expect(labelOfActive()).toBeNull();
  });

  it('未フォーカスから ArrowDown で先頭→次の有効項目へフォーカスが進む', () => {
    showMenu(0, 0, [
      { label: 'A', action: vi.fn() },
      { label: 'B', action: vi.fn() },
    ]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(labelOfActive()).toBe('A');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(labelOfActive()).toBe('B');
  });

  it('Escape で閉じる', () => {
    showMenu(0, 0, [{ label: 'A', action: vi.fn() }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isMenuVisible()).toBe(false);
  });

  it('項目クリックで action を実行して閉じる', () => {
    const action = vi.fn();
    showMenu(0, 0, [{ label: 'A', action }]);
    document.querySelector('.context-menu-item').click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(isMenuVisible()).toBe(false);
  });
});
