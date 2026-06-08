// app.js — メインオーケストレーター (M1)
// 役割: 初期化、キーバインド、安全モード/ペイン/テーマと DOM の同期、
//        2ペインの実ファイル一覧表示とナビゲーション。

import { createSafeMode, MODE } from './core/safemode.js';
import { createPanes, PANE } from './core/panes.js';
import { createTheme, loadStoredTheme, storeTheme } from './core/theme.js';
import { createFilePane } from './core/filepane.js';
import { homeDir } from './backend.js';

const safemode = createSafeMode(MODE.SAFE);
const panes = createPanes(PANE.LEFT);
const theme = createTheme(loadStoredTheme());

// 各ペインの DOM 要素とファイルペイン・コントローラ
const filePanes = { left: null, right: null };

function paneEl(pane) {
  return document.getElementById(pane === PANE.LEFT ? 'pane-left' : 'pane-right');
}

function activeFilePane() {
  return filePanes[panes.getActive()];
}

function syncMode(mode) {
  document.body.dataset.mode = mode;
  const indicator = document.getElementById('mode-indicator');
  if (indicator) {
    indicator.textContent = mode === MODE.SAFE ? '● 安全モード' : '● 操作モード';
    indicator.title =
      mode === MODE.SAFE
        ? '閲覧専用です（切替: Ctrl+Shift+Space）'
        : '変更可能です（切替: Ctrl+Shift+Space）';
  }
}

function syncTheme(t) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = t;
  }
  storeTheme(t);
}

function syncActivePane(active) {
  for (const p of [PANE.LEFT, PANE.RIGHT]) {
    const el = paneEl(p);
    if (!el) continue;
    el.classList.toggle('active', p === active);
  }
  const el = paneEl(active);
  if (el && document.activeElement !== el) el.focus();
  updateStatus();
}

function updateStatus(info) {
  const fp = activeFilePane();
  const pathEl = document.getElementById('status-path');
  const selEl = document.getElementById('status-selection');
  const dir = info ? info.dir : fp && fp.getCurrentDir();
  const entry = info ? info.entry : fp && fp.getCursorEntry();
  const count = info ? info.count : fp && fp.getCount();
  if (pathEl) pathEl.textContent = dir || '';
  if (selEl) {
    const name = entry ? entry.name : '';
    selEl.textContent = count != null ? `${count} 件${name ? ' / ' + name : ''}` : '';
  }
}

function isEditableTarget(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function onKeydown(e) {
  // 安全/操作モード切替: Ctrl+Shift+Space
  if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
    e.preventDefault();
    safemode.toggle();
    return;
  }
  // テーマ切替: Ctrl+Shift+T
  if (e.ctrlKey && e.shiftKey && (e.code === 'KeyT' || e.key.toLowerCase() === 't')) {
    e.preventDefault();
    theme.toggle();
    return;
  }
  // ペイン往復: Tab
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    panes.toggle();
    return;
  }

  // 以降はファイルナビゲーション（修飾キー無し・入力欄以外）
  if (e.ctrlKey || e.altKey || e.metaKey || isEditableTarget(e.target)) return;
  const fp = activeFilePane();
  if (!fp) return;

  switch (e.key) {
    case 'j':
    case 'ArrowDown':
      e.preventDefault();
      fp.moveCursor(1);
      break;
    case 'k':
    case 'ArrowUp':
      e.preventDefault();
      fp.moveCursor(-1);
      break;
    case 'l':
    case 'Enter':
      e.preventDefault();
      fp.enter();
      break;
    case 'h':
    case 'Backspace':
      e.preventDefault();
      fp.goParent();
      break;
    case 'g':
      e.preventDefault();
      fp.moveCursorTo('top');
      break;
    case 'G':
      e.preventDefault();
      fp.moveCursorTo('bottom');
      break;
    default:
      break;
  }
}

async function init() {
  theme.subscribe(syncTheme);
  safemode.subscribe(syncMode);
  panes.subscribe(syncActivePane);
  document.addEventListener('keydown', onKeydown);

  // 2ペインのファイルペインを生成
  for (const p of [PANE.LEFT, PANE.RIGHT]) {
    const el = paneEl(p);
    if (!el) continue;
    filePanes[p] = createFilePane(el, {
      onActivate: () => panes.setActive(p),
      onChange: (info) => {
        if (p === panes.getActive()) updateStatus(info);
      },
    });
    el.addEventListener('mousedown', () => panes.setActive(p));
  }

  // 起動ディレクトリ: ホーム（取得不能時はカレント '.'）
  const start = (await homeDir()) || '.';
  await Promise.all([filePanes.left.load(start), filePanes.right.load(start)]);
  updateStatus();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

// テスト用にエクスポート
export { safemode, panes, theme };
