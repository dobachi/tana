// app.js — メインオーケストレーター (M1)
// 役割: 初期化、キーバインド、安全モード/ペイン/テーマと DOM の同期、
//        2ペインの実ファイル一覧表示とナビゲーション。

import { createSafeMode, MODE } from './core/safemode.js';
import { createPanes, PANE } from './core/panes.js';
import { createTheme, loadStoredTheme, storeTheme } from './core/theme.js';
import {
  createFontScale,
  loadStoredFontScale,
  storeFontScale,
  toPercent,
} from './core/fontscale.js';
import { createFilePane } from './core/filepane.js';
import { createToast } from './core/toast.js';
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

function syncFontScale(scale) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--font-scale', String(scale));
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
  // テーマ切替: Ctrl+Shift+T
  if (e.ctrlKey && e.shiftKey && (e.code === 'KeyT' || e.key.toLowerCase() === 't')) {
    e.preventDefault();
    theme.toggle();
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
  // 文字サイズ: Ctrl++ / Ctrl+- / Ctrl+0 (NFR-U5)
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      toast(`文字サイズ: ${toPercent(fontScale.increase())}%`);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      toast(`文字サイズ: ${toPercent(fontScale.decrease())}%`);
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      toast(`文字サイズ: ${toPercent(fontScale.reset())}%`);
      return;
    }
  }
  // ヘルプ: ? または F1（入力中は無効。Ctrl+? も e.key==='?' で拾える）
  if ((e.key === '?' || e.key === 'F1') && !isEditableTarget(e.target)) {
    e.preventDefault();
    help.toggle();
    return;
  }
  // ヘルプ表示中は背後のナビ操作を無効化（閉じるのは ? / F1 / Esc）
  if (help.isOpen()) return;

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
  createFavoritesView({
    listEl: document.getElementById('favorites'),
    searchEl: document.getElementById('fav-search'),
    favorites,
    onNavigate: navigateActive,
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
      onChange: (info) => {
        if (p === panes.getActive()) updateStatus(info);
      },
    });
    el.addEventListener('mousedown', () => panes.setActive(p));
  }

  // 起動ディレクトリ: CLI 引数 > ホーム > カレント
  const start = (await getCliPath()) || (await homeDir()) || '.';
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
