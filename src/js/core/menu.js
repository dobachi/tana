// menu.js — 汎用ドロップダウン/コンテキストメニュー（Fude と同じ操作感）
// showMenu(x, y, items, opts) の items は { label, action, shortcut?, danger?, disabled? }
// または { separator: true }。矢印/Home/End で移動、Enter/Space で実行、外側
// クリック・Escape で閉じる（キーボードから開いたメニューも操作できるように）。

import { nextEnabledIndex, edgeEnabledIndex } from './menu-nav.js';

let menuEl = null;
let cleanup = null;
let onCloseCallback = null;

/** ドロップダウンが実際に表示されているか（キー処理の唯一の真実源）。 */
export function isMenuVisible() {
  return menuEl != null;
}

export function closeMenu() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  const cb = onCloseCallback;
  onCloseCallback = null;
  if (cb) cb();
}

/**
 * @param {number} x viewport X
 * @param {number} y viewport Y
 * @param {Array<{label?:string,action?:Function,danger?:boolean,separator?:boolean}>} items
 * @param {{onClose?: () => void, focusFirst?: boolean}} [opts]
 *   onClose: 閉じたときに呼ばれる（メニューバーの一時表示を戻すのに使う）
 *   focusFirst: 開いた直後に先頭項目へフォーカス（キーボードから開いた場合）
 */
export function showMenu(x, y, items, opts = {}) {
  closeMenu();
  onCloseCallback = opts.onClose || null;
  menuEl = document.createElement('div');
  menuEl.className = 'context-menu';

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menuEl.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    const labelSpan = document.createElement('span');
    labelSpan.className = 'context-menu-label';
    labelSpan.textContent = item.label;
    btn.appendChild(labelSpan);
    if (item.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'context-menu-shortcut';
      sc.textContent = item.shortcut;
      btn.appendChild(sc);
    }
    if (item.disabled) btn.disabled = true;
    btn.addEventListener('click', () => {
      closeMenu();
      try {
        item.action?.();
      } catch (e) {
        console.error('Context menu action failed:', e);
      }
    });
    menuEl.appendChild(btn);
  }

  document.body.appendChild(menuEl);

  // Keep within viewport.
  const rect = menuEl.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
  menuEl.style.left = `${Math.max(4, left)}px`;
  menuEl.style.top = `${Math.max(4, top)}px`;

  const onDocMouseDown = (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  };
  // 項目の DOM は separator も含めて items と同じ並びなので index で対応が取れる
  const buttons = () => Array.from(menuEl ? menuEl.children : []);
  const focusIndex = (idx) => {
    const el = buttons()[idx];
    if (el && el.focus) el.focus();
  };
  const currentIndex = () => buttons().findIndex((el) => el === document.activeElement);
  // ↑↓Home/End/Esc のみ扱う。ファイラへの漏れは app.js 側が isMenuVisible()
  // を見て早期 return することで防ぐ（stopPropagation に依存しない）。
  // Enter/Space はボタンの既定動作で項目が実行される。←→ は app.js（隣メニュー）。
  const onKey = (e) => {
    if (!menuEl) return;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        return;
      case 'ArrowDown':
        e.preventDefault();
        focusIndex(nextEnabledIndex(items, currentIndex(), 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusIndex(nextEnabledIndex(items, currentIndex(), -1));
        return;
      case 'Home':
        e.preventDefault();
        focusIndex(edgeEnabledIndex(items, 'first'));
        return;
      case 'End':
        e.preventDefault();
        focusIndex(edgeEnabledIndex(items, 'last'));
        return;
      default:
        break;
    }
  };
  const onScroll = () => closeMenu();
  // Defer so the opening right-click doesn't immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onDocMouseDown), 0);
  if (opts.focusFirst) focusIndex(edgeEnabledIndex(items, 'first'));
  document.addEventListener('keydown', onKey);
  window.addEventListener('blur', closeMenu);
  document.addEventListener('scroll', onScroll, true);
  cleanup = () => {
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('blur', closeMenu);
    document.removeEventListener('scroll', onScroll, true);
  };
}
