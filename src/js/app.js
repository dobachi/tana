// app.js — メインオーケストレーター (M0)
// 役割: 初期化、キーバインド、安全モード/ペイン状態と DOM の同期。
// 機能の中身（ファイル一覧・操作・お気に入り）は M1 以降で core/ に実装する。

import { createSafeMode, MODE } from './core/safemode.js';
import { createPanes, PANE } from './core/panes.js';
import { createTheme, loadStoredTheme, storeTheme, THEME_LABELS } from './core/theme.js';

const safemode = createSafeMode(MODE.SAFE);
const panes = createPanes(PANE.LEFT);
const theme = createTheme(loadStoredTheme());

function paneEl(pane) {
  return document.getElementById(pane === PANE.LEFT ? 'pane-left' : 'pane-right');
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
}

function onKeydown(e) {
  // 安全/操作モード切替: Ctrl+Shift+Space (Q1 で確定)
  if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
    e.preventDefault();
    safemode.toggle();
    return;
  }
  // テーマ切替: Ctrl+Shift+T (サイバーダーク ⇄ 白基調シンプル)
  if (e.ctrlKey && e.shiftKey && (e.code === 'KeyT' || e.key.toLowerCase() === 't')) {
    e.preventDefault();
    const next = theme.toggle();
    const indicator = document.getElementById('status-path');
    if (indicator) indicator.textContent = `テーマ: ${THEME_LABELS[next]}`;
    return;
  }
  // ペイン往復: Tab
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    panes.toggle();
    return;
  }
}

function init() {
  theme.subscribe(syncTheme);
  safemode.subscribe(syncMode);
  panes.subscribe(syncActivePane);
  document.addEventListener('keydown', onKeydown);

  // クリックでアクティブペインを切り替え
  for (const p of [PANE.LEFT, PANE.RIGHT]) {
    const el = paneEl(p);
    if (el) el.addEventListener('mousedown', () => panes.setActive(p));
  }
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
