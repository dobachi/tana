// app.js — メインオーケストレーター (M1)
// 役割: 初期化、キーバインド、安全モード/ペイン/テーマと DOM の同期、
//        2ペインの実ファイル一覧表示とナビゲーション。

import { createSafeMode, MODE } from './core/safemode.js';
import { createPanes, PANE } from './core/panes.js';
import { createTheme, loadStoredTheme, storeTheme, THEMES, THEME_LABELS } from './core/theme.js';
import {
  createFontScale,
  loadStoredFontScale,
  storeFontScale,
  toPercent,
  fontScaleAction,
} from './core/fontscale.js';
import { createFilePane } from './core/filepane.js';
import { createToast } from './core/toast.js';
import { checkForUpdates } from './core/updater.js';
import { resolveInputPath } from './core/pathnav.js';
import { initMenuBar, toggleMenuBar } from './core/menubar.js';
import { showMenu } from './core/menu.js';
import { openSettings, closeSettings, isSettingsOpen } from './core/settings.js';
import { createFileOps } from './core/fileops.js';
import { createConflictDialog } from './core/conflictdialog.js';
import { createInputDialog } from './core/inputdialog.js';
import { createFavorites, loadStoredFavorites, storeFavorites } from './core/favorites.js';
import { createFavoritesView } from './core/favoritesview.js';
import { createHelp } from './core/help.js';
import {
  homeDir,
  getCliPath,
  copyPath,
  movePath,
  deleteToTrash,
  deletePermanent,
  uniqueName,
  renamePath,
  makeDir,
  confirmDialog,
  isDesktop,
} from './backend.js';

const safemode = createSafeMode(MODE.SAFE);
const panes = createPanes(PANE.LEFT);
const theme = createTheme(loadStoredTheme());
const fontScale = createFontScale(loadStoredFontScale());
const toast = createToast();
const help = createHelp();
const resolveConflict = createConflictDialog();
const promptName = createInputDialog();
const favorites = createFavorites(loadStoredFavorites());
favorites.subscribe(() => storeFavorites(favorites.toJSON()));
const fileOps = createFileOps({
  canMutate: () => safemode.canMutate(),
  backend: { copyPath, movePath, deleteToTrash, deletePermanent, uniqueName, renamePath, makeDir },
  resolveConflict,
  promptName,
  confirm: confirmDialog,
  toast,
  refresh: refreshPanes,
});

// 各ペインの DOM 要素とファイルペイン・コントローラ
const filePanes = { left: null, right: null };
let favView = null;

// 隠しファイル表示（両ペイン共通, FR-15）
let showHidden = false;

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

/**
 * パス指定でペインを移動する (FR-12)。
 * @param {string} pane PANE.LEFT / PANE.RIGHT
 * @param {string} value ブレッドクラムからは解決済み絶対パス、入力欄からは生の文字列
 * @param {{raw?: boolean}} [o] raw なら ~ 展開・相対解決を通す
 */
async function navigatePane(pane, value, o = {}) {
  const fp = filePanes[pane];
  if (!fp) return;
  const target = o.raw
    ? resolveInputPath(value, { home: await homeDir(), cwd: fp.getCurrentDir() })
    : value;
  if (!target) {
    toast('パスを解釈できませんでした');
    return;
  }
  try {
    await fp.load(target);
    panes.setActive(pane);
    focusActivePane();
    updateStatus();
  } catch {
    // 存在しない・ディレクトリでない・権限が無い等はまとめて弾く
    toast(`開けませんでした: ${target}`);
  }
}

/** パスや名前をクリップボードへ（Tauri でもブラウザでも動くようフォールバック付き） */
async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました');
  } catch {
    toast('コピーできませんでした');
  }
}

/** OS の既定アプリで開く / ファイルマネージャで表示（デスクトップのみ） */
async function openWith(kind, path) {
  if (!path) return;
  if (!isDesktop()) {
    toast('デスクトップ版でのみ利用できます');
    return;
  }
  try {
    const opener = await import('@tauri-apps/plugin-opener');
    if (kind === 'reveal') await opener.revealItemInDir(path);
    else await opener.openPath(path);
  } catch (e) {
    toast('開けませんでした: ' + (e && e.message ? e.message : e));
  }
}

/**
 * ファイル一覧の右クリックメニュー (FR-13)。
 * 破壊操作は fileOps 側で安全モードのゲートに掛かる（ここでは隠さず、
 * 押したときに理由がトーストで出るほうが分かりやすい）。
 * @param {string} pane PANE.LEFT / PANE.RIGHT
 * @param {{entry: object|null, x: number, y: number}} info
 */
function showEntryMenu(pane, info) {
  const fp = filePanes[pane];
  if (!fp) return;
  const { entry, x, y } = info;
  const destDir = filePanes[panes.getInactive()]?.getCurrentDir();
  const items = [];

  if (entry) {
    if (entry.is_dir) {
      items.push({ label: '開く', shortcut: 'Enter', action: () => navigateActive(entry.path) });
    } else {
      items.push({ label: '外部アプリで開く', action: () => openWith('open', entry.path) });
    }
    items.push(
      { label: 'ファイルマネージャで表示', action: () => openWith('reveal', entry.path) },
      { separator: true },
      {
        label: '反対のペインへコピー',
        shortcut: 'F5',
        disabled: !destDir,
        action: () => fileOps.copy(entry, destDir),
      },
      {
        label: '反対のペインへ移動',
        shortcut: 'F6',
        disabled: !destDir,
        action: () => fileOps.move(entry, destDir),
      },
      { separator: true },
      { label: '名前を変更…', shortcut: 'F2', action: () => fileOps.rename(entry) },
      {
        label: 'ゴミ箱へ',
        shortcut: 'Delete',
        danger: true,
        action: () => fileOps.trash(entry),
      },
      {
        label: '完全に削除',
        shortcut: 'Shift+Delete',
        danger: true,
        action: () => fileOps.deletePermanent(entry),
      },
      { separator: true },
      { label: 'パスをコピー', action: () => copyText(entry.path) },
      { label: '名前をコピー', action: () => copyText(entry.name) },
      { separator: true },
    );
  }

  items.push(
    {
      label: '新しいフォルダ…',
      shortcut: 'F7',
      action: () => fileOps.makeNewFolder(fp.getCurrentDir()),
    },
    { label: 'ここをお気に入りに追加', shortcut: 'Ctrl+D', action: addCurrentToFavorites },
    { separator: true },
    { label: '現在地のパスをコピー', action: () => copyText(fp.getCurrentDir()) },
    {
      label: '現在地をファイルマネージャで表示',
      action: () => openWith('reveal', fp.getCurrentDir()),
    },
  );

  showMenu(x, y, items);
}

/** 設定画面を開閉する（Ctrl+, とメニューから） */
function toggleSettings() {
  if (isSettingsOpen()) {
    closeSettings();
    return;
  }
  openSettings({
    theme,
    fontScale,
    getShowHidden: () => showHidden,
    setShowHidden,
  });
}

/**
 * メニューバーの定義。items を関数にすると開くたびに現在の状態を反映できる
 * （チェック状態など）。
 */
function buildMenuDefinition() {
  return [
    {
      label: 'ファイル',
      items: () => [
        { label: 'お気に入りに現在地を追加', shortcut: 'Ctrl+D', action: addCurrentToFavorites },
        { separator: true },
        { label: '終了', action: () => window.close() },
      ],
    },
    {
      label: '表示',
      items: () => [
        {
          label: showHidden ? '✓ 隠しファイルを表示' : '隠しファイルを表示',
          shortcut: 'Ctrl+H',
          action: toggleHidden,
        },
        { separator: true },
        ...THEMES.map((t) => ({
          label: `${theme.get() === t ? '✓ ' : ''}${THEME_LABELS[t]}`,
          action: () => theme.set(t),
        })),
        { separator: true },
        { label: '文字を大きく', shortcut: 'Ctrl++', action: () => applyFontScale('increase') },
        { label: '文字を小さく', shortcut: 'Ctrl+-', action: () => applyFontScale('decrease') },
        {
          label: '文字サイズをリセット',
          shortcut: 'Ctrl+0',
          action: () => applyFontScale('reset'),
        },
        { separator: true },
        { label: 'メニューバーを隠す', shortcut: 'Ctrl+Shift+B', action: toggleMenuBar },
        { separator: true },
        { label: '設定…', shortcut: 'Ctrl+,', action: toggleSettings },
      ],
    },
    {
      label: 'ヘルプ',
      items: () => [
        { label: 'ショートカット一覧', shortcut: '?', action: () => help.toggle() },
        { separator: true },
        {
          label: '更新を確認',
          action: () => checkForUpdates({ manual: true, notify: toast }),
        },
      ],
    },
  ];
}

/**
 * 文字サイズを増減/リセットし、結果を通知する。
 * キーボードとステータスバーのボタンで同じ経路を通す。
 * @param {'increase'|'decrease'|'reset'} action
 */
function applyFontScale(action) {
  const pct = toPercent(fontScale[action]());
  toast(`文字サイズ: ${pct}%`);
}

function syncFontScale(scale) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--font-scale', String(scale));
  }
  const label = typeof document !== 'undefined' && document.getElementById('font-reset');
  if (label) {
    label.textContent = `${toPercent(scale)}%`;
    label.title = `文字サイズ ${toPercent(scale)}%（クリックで100%に戻す）`;
  }
  storeFontScale(scale);
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

async function refreshPanes() {
  const jobs = [];
  for (const p of [PANE.LEFT, PANE.RIGHT]) {
    const fp = filePanes[p];
    if (fp && fp.getCurrentDir()) jobs.push(fp.load(fp.getCurrentDir()));
  }
  await Promise.all(jobs);
  updateStatus();
}

// アクティブペインの選択項目を、非アクティブペインのディレクトリへ
function opCopy() {
  const src = activeFilePane();
  const dest = filePanes[panes.getInactive()];
  if (src && dest) fileOps.copy(src.getCursorEntry(), dest.getCurrentDir());
}
function opMove() {
  const src = activeFilePane();
  const dest = filePanes[panes.getInactive()];
  if (src && dest) fileOps.move(src.getCursorEntry(), dest.getCurrentDir());
}
function opTrash() {
  const fp = activeFilePane();
  if (fp) fileOps.trash(fp.getCursorEntry());
}
function opDeletePermanent() {
  const fp = activeFilePane();
  if (fp) fileOps.deletePermanent(fp.getCursorEntry());
}
function opRename() {
  const fp = activeFilePane();
  if (fp) fileOps.rename(fp.getCursorEntry());
}
function opMakeFolder() {
  const fp = activeFilePane();
  if (fp) fileOps.makeNewFolder(fp.getCurrentDir());
}
function navigateActive(path) {
  const fp = activeFilePane();
  if (fp && path) fp.load(path);
}
function focusActivePane() {
  const el = paneEl(panes.getActive());
  if (el) el.focus();
}
function toggleSidebarFocus() {
  if (favView && favView.isFocused()) focusActivePane();
  else if (favView) favView.focusFirst();
}
async function addCurrentToFavorites() {
  const fp = activeFilePane();
  const dir = fp && fp.getCurrentDir();
  if (!dir) return;
  const base = dir.split(/[/\\]/).filter(Boolean).pop() || dir;
  const name = await promptName('お気に入りに追加', base);
  if (name == null) return;
  favorites.addBookmark(name.trim() || base, dir);
  toast('お気に入りに追加しました');
}

function setShowHidden(next) {
  if (showHidden === next) return;
  toggleHidden();
}

function toggleHidden() {
  showHidden = !showHidden;
  if (filePanes.left) filePanes.left.setShowHidden(showHidden);
  if (filePanes.right) filePanes.right.setShowHidden(showHidden);
  const el = document.getElementById('status-hidden');
  if (el) el.textContent = showHidden ? '隠し: 表示' : '';
  updateStatus();
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
  // メニューバー開閉: Ctrl+Shift+B（Fude と同じ）
  if (e.ctrlKey && e.shiftKey && (e.code === 'KeyB' || e.key.toLowerCase() === 'b')) {
    e.preventDefault();
    toggleMenuBar();
    return;
  }
  // コンテキストメニュー: Shift+F10 / メニューキー（キーボードからも到達可能に）
  if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
    e.preventDefault();
    const fp = activeFilePane();
    if (fp) {
      const pt = fp.getCursorPoint();
      showEntryMenu(panes.getActive(), { entry: fp.getCursorEntry(), x: pt.x, y: pt.y });
    }
    return;
  }
  // パス入力: Ctrl+L（ブラウザ/ファイラの慣習に合わせる）(FR-12)
  if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.code === 'KeyL' || e.key.toLowerCase() === 'l')) {
    e.preventDefault();
    const fp = filePanes[panes.getActive()];
    if (fp) fp.beginPathEdit();
    return;
  }
  // 設定: Ctrl+,（Fude と同じ）
  if (e.ctrlKey && !e.altKey && (e.code === 'Comma' || e.key === ',')) {
    e.preventDefault();
    toggleSettings();
    return;
  }
  // 隠しファイル表示切替: Ctrl+H (FR-15)
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyH' || e.key.toLowerCase() === 'h')) {
    e.preventDefault();
    toggleHidden();
    return;
  }
  // お気に入りに現在地を追加: Ctrl+D (FR-05)
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyD' || e.key.toLowerCase() === 'd')) {
    e.preventDefault();
    addCurrentToFavorites();
    return;
  }
  // サイドバー(お気に入り) ⇄ ペイン のフォーカス切替: Ctrl+B
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyB' || e.key.toLowerCase() === 'b')) {
    e.preventDefault();
    toggleSidebarFocus();
    return;
  }
  // 文字サイズ: Ctrl++ / Ctrl+- / Ctrl+0 (NFR-U5)
  const fsAction = fontScaleAction(e);
  if (fsAction) {
    e.preventDefault();
    applyFontScale(fsAction);
    return;
  }
  // ヘルプ: ? または F1（入力中は無効。Ctrl+? も e.key==='?' で拾える）
  if ((e.key === '?' || e.key === 'F1') && !isEditableTarget(e.target)) {
    e.preventDefault();
    help.toggle();
    return;
  }
  // ヘルプ表示中は背後のナビ操作を無効化（閉じるのは ? / F1 / Esc）
  if (help.isOpen()) return;
  // サイドバーがフォーカス中はペイン操作を無効化（操作は favoritesview 側で処理）
  if (favView && favView.isFocused()) return;

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
    case 'F5':
      e.preventDefault();
      opCopy();
      break;
    case 'F6':
      e.preventDefault();
      opMove();
      break;
    case 'Delete':
      e.preventDefault();
      if (e.shiftKey) opDeletePermanent();
      else opTrash();
      break;
    case 'F2':
      e.preventDefault();
      opRename();
      break;
    case 'F7':
      e.preventDefault();
      opMakeFolder();
      break;
    default:
      break;
  }
}

async function init() {
  theme.subscribe(syncTheme);
  fontScale.subscribe(syncFontScale);
  safemode.subscribe(syncMode);
  panes.subscribe(syncActivePane);
  document.addEventListener('keydown', onKeydown);

  // お気に入りサイドバー
  favView = createFavoritesView({
    listEl: document.getElementById('favorites'),
    searchEl: document.getElementById('fav-search'),
    favorites,
    onNavigate: navigateActive,
    onReturn: focusActivePane,
    promptName,
  });
  const addFolderBtn = document.getElementById('fav-add-folder');
  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', async () => {
      const name = await promptName('フォルダ名', '新しいフォルダ');
      if (name && name.trim()) favorites.addFolder(name.trim());
    });
  }

  // 2ペインのファイルペインを生成
  for (const p of [PANE.LEFT, PANE.RIGHT]) {
    const el = paneEl(p);
    if (!el) continue;
    filePanes[p] = createFilePane(el, {
      showHidden,
      onActivate: () => panes.setActive(p),
      onNavigate: (value, o) => navigatePane(p, value, o),
      onContextMenu: (info) => showEntryMenu(p, info),
      onChange: (info) => {
        if (p === panes.getActive()) updateStatus(info);
      },
    });
    el.addEventListener('mousedown', () => panes.setActive(p));
  }

  // メニューバー（既定は非表示。Ctrl+Shift+B で開閉）
  const menuBarEl = document.getElementById('menu-bar');
  if (menuBarEl) initMenuBar(menuBarEl, buildMenuDefinition());

  // 文字サイズ（ステータスバー）
  for (const [id, action] of [
    ['font-smaller', 'decrease'],
    ['font-reset', 'reset'],
    ['font-larger', 'increase'],
  ]) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => applyFontScale(action));
  }

  // 更新を確認（ステータスバー）
  const updateBtn = document.getElementById('check-updates');
  if (updateBtn) {
    updateBtn.addEventListener('click', () => checkForUpdates({ manual: true, notify: toast }));
  }

  // 起動ディレクトリ: CLI 引数 > ホーム > カレント
  const start = (await getCliPath()) || (await homeDir()) || '.';
  await Promise.all([filePanes.left.load(start), filePanes.right.load(start)]);
  updateStatus();

  // 起動時の更新検知。待たない・失敗しても黙る（起動を妨げないため）。
  checkForUpdates();
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
