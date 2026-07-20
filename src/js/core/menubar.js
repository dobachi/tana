// menubar.js — 開閉できるメニューバー（Fude と同じ操作感）
//
// トップレベルのメニュー（「ファイル」「表示」…）を並べ、ドロップダウンは
// showMenu() を再利用する。表示/非表示はショートカット（app.js で結線）で
// 切り替え、localStorage に永続化する。既定は非表示。

import { showMenu, closeMenu } from './menu.js';
import { menuIndexForAccessKey } from './menu-nav.js';

const VISIBLE_KEY = 'tana.menuBarVisible';

let barEl = null;
/** @type {Array<{label:string, accessKey?:string, items: any[]|(() => any[])}>} */
let menuDef = [];
let openIndex = -1;
// Alt から開いたときだけ一時的に表示している状態（永続化しない）。
let temporarilyShown = false;

/** Whether the menu bar is currently shown. */
export function isMenuBarVisible() {
  return !!barEl && !barEl.classList.contains('hidden');
}

/** Show or hide the menu bar and persist the choice. */
export function setMenuBarVisible(visible) {
  if (!barEl) return;
  barEl.classList.toggle('hidden', !visible);
  if (!visible) {
    closeMenu();
    openIndex = -1;
    syncOpenClass();
  }
  try {
    localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0');
  } catch {
    /* storage may be unavailable */
  }
}

/** Toggle menu bar visibility. */
export function toggleMenuBar() {
  setMenuBarVisible(!isMenuBarVisible());
}

/**
 * 保存済みの表示状態を読む。未設定なら「表示」。
 *
 * Fude は非表示が既定だが、Tana では表示を既定にする。メニューバーは
 * 「ショートカットを知らないと機能に辿り着けない」問題を解消するために
 * 入れたものなので、それ自体をショートカットでしか出せないのでは意味が無い。
 * 明示的に隠した人（'0' を保存済み）はその選択を維持する。
 */
export function getStoredMenuBarVisible() {
  try {
    return localStorage.getItem(VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

function syncOpenClass() {
  if (!barEl) return;
  const btns = barEl.querySelectorAll('.menu-bar-item');
  btns.forEach((b, i) => b.classList.toggle('open', i === openIndex));
}

/** Resolve a menu's items (supports a function for dynamic state). */
function itemsFor(menu) {
  return typeof menu.items === 'function' ? menu.items() : menu.items;
}

/**
 * ドロップダウンが閉じたときの後始末。別メニューへ切り替えただけの場合は
 * openMenuAt が直後に openIndex を立て直すので、次のタスクで見て -1 のままなら
 * 本当に閉じたと判断し、一時表示を元に戻す。
 */
function handleDropdownClosed() {
  openIndex = -1;
  syncOpenClass();
  setTimeout(() => {
    if (openIndex === -1 && temporarilyShown) {
      temporarilyShown = false;
      if (barEl) barEl.classList.add('hidden'); // 永続化はしない
    }
  }, 0);
}

/** 非表示なら一時的に表示する（永続化しない）。 */
function revealTemporarily() {
  if (!barEl || isMenuBarVisible()) return;
  barEl.classList.remove('hidden');
  temporarilyShown = true;
}

function openMenuAt(index, opts = {}) {
  if (!barEl) return;
  const btn = barEl.querySelectorAll('.menu-bar-item')[index];
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  // showMenu が内部で前のメニューを閉じ、その onClose が openIndex を -1 に
  // するので、index の設定は showMenu の後に行う。
  showMenu(rect.left, rect.bottom, itemsFor(menuDef[index]), {
    onClose: handleDropdownClosed,
    focusFirst: opts.fromKeyboard === true,
  });
  openIndex = index;
  syncOpenClass();
}

/**
 * Alt 単押しで呼ばれる。メニューバーを（必要なら一時表示して）出し、先頭の
 * メニューを開く。既に開いていれば閉じる。
 */
export function focusMenuBar() {
  if (!barEl || !menuDef.length) return;
  if (openIndex !== -1) {
    closeMenu();
    return;
  }
  revealTemporarily();
  openMenuAt(0, { fromKeyboard: true });
}

/**
 * Alt+文字。対応するメニューがあれば開いて true を返す。無ければ false。
 * @param {string} key
 */
export function openMenuByAccessKey(key) {
  if (!barEl || !menuDef.length) return false;
  const index = menuIndexForAccessKey(menuDef, key);
  if (index < 0) return false;
  revealTemporarily();
  openMenuAt(index, { fromKeyboard: true });
  return true;
}

/** 開いているメニューの左右移動（←→）。 */
export function moveOpenMenu(step) {
  if (openIndex === -1 || !menuDef.length) return false;
  const next = (openIndex + step + menuDef.length) % menuDef.length;
  openMenuAt(next, { fromKeyboard: true });
  return true;
}

/** メニューが開いているか（キー処理の分岐に使う）。 */
export function isMenuOpen() {
  return openIndex !== -1;
}

/**
 * Build the menu bar into `container`.
 * @param {HTMLElement} container the #menu-bar element
 * @param {Array<{label:string, items:any[]|(() => any[])}>} menus
 */
export function initMenuBar(container, menus) {
  barEl = container;
  menuDef = menus;
  container.innerHTML = '';

  menus.forEach((menu, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-bar-item';
    btn.textContent = menu.label;
    btn.setAttribute('role', 'menuitem');
    if (menu.accessKey) {
      // 実際の Alt+文字処理は app.js。ここは表示/支援技術向けの情報のみ。
      btn.setAttribute('aria-keyshortcuts', `Alt+${menu.accessKey}`);
      btn.title = `Alt+${menu.accessKey}`;
    }

    btn.addEventListener('click', () => {
      // Toggle: clicking the open menu closes it.
      if (openIndex === index) {
        closeMenu();
        openIndex = -1;
        syncOpenClass();
      } else {
        openMenuAt(index);
      }
    });

    // Classic menu-bar behavior: once a menu is open, hovering another switches.
    btn.addEventListener('mouseenter', () => {
      if (openIndex !== -1 && openIndex !== index) openMenuAt(index);
    });

    container.appendChild(btn);
  });

  // Reflect the persisted state on startup (default hidden).
  setMenuBarVisible(getStoredMenuBarVisible());
}
