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
  wheelFontScaleAction,
} from './core/fontscale.js';
import { createFilePane } from './core/filepane.js';
import { createPreview } from './core/preview.js';
import {
  createPreviewPlacement,
  loadStoredPlacement,
  storePlacement,
} from './core/previewplacement.js';
import { createPreviewZoom, wheelZoomDir } from './core/previewzoom.js';
import { nextPreviewHeight, loadPreviewHeight, storePreviewHeight } from './core/previewresize.js';
import { createSortState, loadStoredSort, storeSort } from './core/sortstate.js';
import { SORT_KEYS, SORT_LABELS } from './core/sort.js';
import { loadSession, storeSession, createSessionSaver } from './core/session.js';
import { createToast } from './core/toast.js';
import { checkForUpdates } from './core/updater.js';
import { resolveInputPath, describeOpenError, parentPath } from './core/pathnav.js';
import { createSearch } from './core/searchview.js';
import { createWorkspaces, loadStoredWorkspaces, storeWorkspaces } from './core/workspaces.js';
import { createWorkspacesView } from './core/workspacesview.js';
import {
  initMenuBar,
  toggleMenuBar,
  focusMenuBar,
  openMenuByAccessKey,
  moveOpenMenu,
} from './core/menubar.js';
import { showMenu, isMenuVisible } from './core/menu.js';
import { createAltTap } from './core/menu-nav.js';
import { openSettings, closeSettings, isSettingsOpen } from './core/settings.js';
import { createFileOps } from './core/fileops.js';
import { createFileClipboard } from './core/clipboard.js';
import { createDragSession } from './core/dragdrop.js';
import { buildEditMenuItems } from './core/editmenu.js';
import { createConflictDialog } from './core/conflictdialog.js';
import { createInputDialog } from './core/inputdialog.js';
import { createNavHistory } from './core/navhistory.js';
import { createTabList } from './core/tabs.js';
import { isPrefixLeader, resolvePrefixAction, prefixHint } from './core/keyprefix.js';
import { createFavorites, loadStoredFavorites, storeFavorites } from './core/favorites.js';
import {
  createExtApps,
  loadStoredExtApps,
  storeExtApps,
  pickByIndex,
  describeAppError,
  normalizeApp,
  validateApp,
  QUICK_SLOTS,
} from './core/extapps.js';
import {
  TARGET,
  NO_WSL,
  normalizeInfo,
  resolveAppTarget,
  resolveDefaultTarget,
  openLabel,
  loadStoredDefaultOpen,
  storeDefaultOpen,
} from './core/wsl.js';
import { createFavoritesView } from './core/favoritesview.js';
import { createPlacesView } from './core/placesview.js';
import { createHelp } from './core/help.js';
import {
  homeDir,
  appVersion,
  getCliPath,
  listPlaces,
  searchDir,
  cancelSearch,
  dirSignature,
  copyPath,
  movePath,
  deleteToTrash,
  deletePermanent,
  uniqueName,
  renamePath,
  makeDir,
  confirmDialog,
  isDesktop,
  readPreview,
  assetUrl,
  wslInfo,
  windowsPath,
  openInWindows,
  revealInWindows,
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
const extApps = createExtApps(loadStoredExtApps());
extApps.subscribe(() => storeExtApps(extApps.list()));
// WSL 連携 (FR-13 の WSL 拡張)。実体は init() で Rust に問い合わせて差し替える。
// それまでは「使えない」= 従来どおり OS 既定の opener だけ、として振る舞う。
let wsl = { ...NO_WSL };
let wslDefaultOpen = loadStoredDefaultOpen();
const fileOps = createFileOps({
  canMutate: () => safemode.canMutate(),
  backend: { copyPath, movePath, deleteToTrash, deletePermanent, uniqueName, renamePath, makeDir },
  resolveConflict,
  promptName,
  confirm: confirmDialog,
  toast,
  refresh: refreshPanes,
});

// ファイルクリップボード (FR-02): Ctrl+C コピー / Ctrl+X 切り取り / Ctrl+V 貼り付け。
// F5/F6 が「反対ペイン固定」なのに対し、こちらは任意の現在地へ貼れる汎用経路。
const fileClipboard = createFileClipboard();

// 各ペインの DOM 要素とファイルペイン・コントローラ
const filePanes = { left: null, right: null };

// ナビゲーション履歴 (FR-17): ペインごとの戻る/進む。dir 変化を onChange で
// 検知して積む。back/forward 起因の移動は再積みしないよう navSuppress で抑止。
const navHistory = { left: createNavHistory(), right: createNavHistory() };
const navLastDir = { left: null, right: null };
const navSuppress = { left: false, right: false };

/** dir 変化を履歴へ反映する（カーソル移動では呼ばれても dir 同一なので無視）。 */
function recordNav(pane, dir) {
  if (!dir || dir === navLastDir[pane]) return;
  navLastDir[pane] = dir;
  if (navSuppress[pane]) {
    navSuppress[pane] = false; // back/forward による移動は積まない
    return;
  }
  navHistory[pane].visit(dir);
}

// タブ (FR-08): ペインごとのタブ。各タブは dir + 表示状態(カーソル/選択)を持つ。
// タブ本体の状態は core/tabs.js（純粋）、読み込み/保存は filepane と結線する。
const paneTabs = { left: null, right: null };

function tabLabel(dir) {
  if (!dir) return '—';
  const base = dir.split(/[/\\]/).filter(Boolean).pop();
  return base || dir; // ドライブ直下やルートは dir をそのまま出す
}

/** アクティブタブへ現在の dir と表示状態を退避する。 */
function saveActiveTabState(p) {
  const fp = filePanes[p];
  const tl = paneTabs[p];
  if (!fp || !tl) return;
  tl.setActiveDir(fp.getCurrentDir());
  tl.setActiveState(fp.getViewState());
}

/** アクティブタブの dir を読み込み、保存済みの表示状態を復元する。 */
async function switchToActiveTab(p) {
  const fp = filePanes[p];
  const tl = paneTabs[p];
  if (!fp || !tl) return;
  const tab = tl.active();
  navSuppress[p] = true; // タブ切替の load は履歴に積まない
  try {
    await fp.load(tab.dir);
  } catch {
    navSuppress[p] = false;
    toast(describeOpenError(tab.dir));
  }
  fp.applyViewState(tab.state);
  renderTabs(p);
  if (p === panes.getActive()) updateStatus();
}

/** 新しいタブ（現在地を複製）。 */
function newTab(p) {
  const fp = filePanes[p];
  const tl = paneTabs[p];
  if (!fp || !tl) return;
  panes.setActive(p);
  saveActiveTabState(p);
  tl.add(fp.getCurrentDir()); // 状態はまっさら（先頭から）
  switchToActiveTab(p);
}

/** タブを閉じる（省略時はアクティブ）。最後の1枚は残す。 */
function closeTab(p, index) {
  const tl = paneTabs[p];
  if (!tl) return;
  const idx = index == null ? tl.activeIndex() : index;
  const wasActive = idx === tl.activeIndex();
  if (!tl.close(idx)) {
    toast('最後のタブは閉じられません');
    return;
  }
  if (wasActive) switchToActiveTab(p);
  else renderTabs(p);
}

/** index のタブへ切り替える。 */
function selectTab(p, index) {
  const tl = paneTabs[p];
  if (!tl) return;
  panes.setActive(p);
  if (index === tl.activeIndex()) {
    focusActivePane();
    return;
  }
  saveActiveTabState(p);
  tl.activate(index);
  switchToActiveTab(p);
}

/** 次(+1)/前(-1)のタブへ。 */
function switchTab(p, dir) {
  const tl = paneTabs[p];
  if (!tl || tl.count() <= 1) return;
  saveActiveTabState(p);
  if (dir < 0) tl.prev();
  else tl.next();
  switchToActiveTab(p);
}

/** ディレクトリ移動をアクティブタブに反映（dir が変わったときだけ再描画）。 */
function syncActiveTab(p, dir) {
  const tl = paneTabs[p];
  if (!tl || tl.active().dir === dir) return;
  tl.setActiveDir(dir);
  renderTabs(p);
}

/** タブ帯を描画する。クリックで選択、× / 中クリックで閉じる、+ で新規。 */
function renderTabs(p) {
  const strip = document.getElementById(p === PANE.LEFT ? 'tabs-left' : 'tabs-right');
  const tl = paneTabs[p];
  if (!strip || !tl) return;
  strip.replaceChildren();
  const activeIdx = tl.activeIndex();
  const multi = tl.count() > 1;
  tl.list().forEach((t, i) => {
    const tab = document.createElement('div');
    tab.className = 'pane-tab' + (i === activeIdx ? ' active' : '');
    tab.title = t.dir;
    tab.setAttribute('role', 'tab');
    const label = document.createElement('span');
    label.className = 'pane-tab-label';
    label.textContent = tabLabel(t.dir);
    tab.appendChild(label);
    // クリック=選択 / 横ドラッグ=並べ替え を閾値で判別（pointer ベース）。
    tab.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(p, i); // 中クリックで閉じる
        return;
      }
      if (e.button !== 0) return;
      const startX = e.clientX;
      let dragging = false;
      const onMove = (ev) => {
        if (!dragging && Math.abs(ev.clientX - startX) >= 5) {
          dragging = true;
          tab.classList.add('dragging');
        }
      };
      const onUp = (ev) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        tab.classList.remove('dragging');
        if (!dragging) {
          selectTab(p, i);
          return;
        }
        reorderTab(p, i, tabDropIndex(strip, ev.clientX));
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    if (multi) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'pane-tab-close';
      x.textContent = '×';
      x.title = '閉じる (Ctrl+W)';
      x.addEventListener('pointerdown', (e) => e.stopPropagation()); // タブのドラッグを開始させない
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(p, i);
      });
      tab.appendChild(x);
    }
    strip.appendChild(tab);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'pane-tab-add';
  add.textContent = '+';
  add.title = '新しいタブ (Ctrl+T)';
  add.addEventListener('click', () => newTab(p));
  strip.appendChild(add);
}

/** ポインタ X から「どのタブの手前に入れるか」の index を返す（0..タブ数）。 */
function tabDropIndex(strip, x) {
  const els = [...strip.querySelectorAll('.pane-tab')];
  for (let k = 0; k < els.length; k++) {
    const r = els[k].getBoundingClientRect();
    if (x < r.left + r.width / 2) return k;
  }
  return els.length; // 末尾
}

/** タブを from → to(insert-before) へ並べ替え、再描画・保存する。 */
function reorderTab(p, from, to) {
  const tl = paneTabs[p];
  if (!tl) return;
  tl.move(from, to);
  renderTabs(p);
  sessionSaver.schedule(); // 並び順を永続化
}

/** アクティブタブを左(-1)/右(+1)へ1つ移動する（キーボード並べ替え）。 */
function moveActiveTab(p, dir) {
  const tl = paneTabs[p];
  if (!tl || tl.count() < 2) return;
  const i = tl.activeIndex();
  if (dir < 0 && i > 0) reorderTab(p, i, i - 1);
  else if (dir > 0 && i < tl.count() - 1) reorderTab(p, i, i + 2);
}

/** 二打鍵プレフィックスで確定したアクションを実行する。 */
function runPrefixAction(action) {
  const fp = activeFilePane();
  const entry = fp ? fp.getCursorEntry() : null;
  switch (action) {
    case 'sort:name':
      sortState.applyKey('name');
      break;
    case 'sort:size':
      sortState.applyKey('size');
      break;
    case 'sort:modified':
      sortState.applyKey('modified');
      break;
    case 'sort:ext':
      sortState.applyKey('ext');
      break;
    case 'sort:reverse':
      sortState.reverse();
      break;
    case 'tab:left':
      moveActiveTab(panes.getActive(), -1);
      break;
    case 'tab:right':
      moveActiveTab(panes.getActive(), 1);
      break;
    case 'copy:path':
      if (entry) copyText(entry.path);
      break;
    case 'copy:name':
      if (entry) copyText(entry.name);
      break;
    case 'copy:dir':
      if (fp) copyText(fp.getCurrentDir());
      break;
    case 'open:app':
      if (entry) openWith('open', entry.path);
      break;
    case 'open:reveal':
      if (entry) openWith('reveal', entry.path);
      break;
    case 'open:with:ask':
      if (entry) openWithPrompt(entry.path);
      break;
    // WSL 専用の二打鍵。非 WSL では黙って無反応にせず理由を出す。
    case 'open:windows':
      if (entry) openOnWindows('open', entry.path);
      break;
    case 'open:explorer':
      if (entry) openOnWindows('reveal', entry.path);
      break;
    default:
      // o → 1..9: 登録した外部アプリのスロット
      if (action.startsWith('open:with:') && entry) {
        openWithSlot(entry.path, action.slice('open:with:'.length));
      }
      break;
  }
}

/** アクティブペインで戻る/進む。dir を履歴から取り出して読み込む。 */
function navGo(dir /* -1=戻る / +1=進む */) {
  const pane = panes.getActive();
  const fp = filePanes[pane];
  if (!fp) return;
  const target = dir < 0 ? navHistory[pane].back() : navHistory[pane].forward();
  if (!target) {
    toast(dir < 0 ? 'これ以上戻れません' : 'これ以上進めません');
    return;
  }
  navSuppress[pane] = true;
  fp.load(target).catch(() => {
    // 消えた場所へは戻れない。履歴の齟齬を避けるため現在地を積み直す。
    navSuppress[pane] = false;
    toast(describeOpenError(target));
  });
}

// ドラッグ＆ドロップ (FR-02/FR-11)。既定はコピー、Shift 押下中は移動。
// 実際のファイル操作・衝突解決・安全モードのゲートは fileOps 側が持つ。
const dragSession = createDragSession({
  getPaneDir: (pane) => (filePanes[pane] ? filePanes[pane].getCurrentDir() : null),
  canMutate: () => safemode.canMutate(),
  onDrop: ({ sources, destDir, effect }) => {
    if (effect === 'move') fileOps.move(sources, destDir);
    else fileOps.copy(sources, destDir);
  },
  toast,
});
let favView = null;
let placesView = null;

// 現在ディレクトリ内検索 (FR-18)。オーバーレイUIは searchview.js。
const search = createSearch({
  searchDir,
  cancelSearch,
  getDir: () => {
    const fp = activeFilePane();
    return fp ? fp.getCurrentDir() : null;
  },
  onOpen: (hit) => openSearchHit(hit),
});

// ワークスペース（タブ構成の保存/復元）。永続化は localStorage。
const workspaces = createWorkspaces(loadStoredWorkspaces());
workspaces.subscribe(() => storeWorkspaces(workspaces.toJSON()));
const workspacesView = createWorkspacesView({
  workspaces,
  getContext: () => {
    const fp = activeFilePane();
    return {
      snapshot: captureWorkspaceSnapshot(),
      suggestedName: fp ? tabLabel(fp.getCurrentDir()) : '',
    };
  },
  onOpen: (ws) => applyWorkspace(ws),
});

/** 現在の両ペインのタブ構成をスナップショットにする。 */
function captureWorkspaceSnapshot() {
  const dirs = (p) => (paneTabs[p] ? paneTabs[p].list().map((t) => t.dir) : []);
  const active = (p) => (paneTabs[p] ? paneTabs[p].activeIndex() : 0);
  return {
    left: dirs(PANE.LEFT),
    right: dirs(PANE.RIGHT),
    activeLeft: active(PANE.LEFT),
    activeRight: active(PANE.RIGHT),
    active: panes.getActive(),
  };
}

/** 保存済みワークスペースを両ペインに適用する（タブを作り直して読み込む）。 */
async function applyWorkspace(ws) {
  if (!ws) return;
  const home = (await homeDir()) || '.';
  for (const [p, list, idx] of [
    [PANE.LEFT, ws.left, ws.activeLeft],
    [PANE.RIGHT, ws.right, ws.activeRight],
  ]) {
    const fp = filePanes[p];
    if (!fp || !Array.isArray(list) || !list.length) continue;
    paneTabs[p] = createTabList(list[0]);
    for (let i = 1; i < list.length; i++) paneTabs[p].add(list[i]);
    paneTabs[p].activate(Math.min(idx || 0, list.length - 1));
    navSuppress[p] = true;
    try {
      await fp.load(paneTabs[p].active().dir);
    } catch {
      navSuppress[p] = false;
      try {
        await fp.load(home);
      } catch {
        /* home も失敗ならそのまま */
      }
    }
    paneTabs[p].setActiveDir(fp.getCurrentDir());
    renderTabs(p);
  }
  panes.setActive(ws.active === PANE.RIGHT ? PANE.RIGHT : PANE.LEFT);
  updateStatus();
  sessionSaver.schedule();
}

/** 検索ヒットを開く。ディレクトリは中へ、ファイルは親へ移動してカーソルを合わせる。 */
function openSearchHit(hit) {
  const fp = activeFilePane();
  if (!fp || !hit || !hit.path) return;
  if (hit.is_dir) {
    fp.load(hit.path).catch((e) => toast(describeOpenError(hit.path, e)));
    focusActivePane();
    return;
  }
  const parent = parentPath(hit.path);
  if (!parent) return;
  fp.load(parent)
    .then(() => fp.applyViewState({ cursorPath: hit.path, selection: [] }))
    .catch((e) => toast(describeOpenError(parent, e)));
  focusActivePane();
}

// プレビュー (FR-09): 配置状態の真実源 + コントローラ
const previewPlacement = createPreviewPlacement(loadStoredPlacement());
// プレビュー画像の表示モード (FR-16): 既定フィット、クリックで実寸切替。
const previewZoom = createPreviewZoom();
const preview = createPreview({
  backend: { readPreview, assetUrl },
  getContainer: () => document.getElementById('preview-content'),
  getInfoContainer: () => document.getElementById('preview-info'),
  onImage: (container) => wireImageZoom(container),
});

/**
 * 描画された画像に表示モード（フィット/実寸）を結線する (FR-16)。
 * 画像が変わるたびにフィットへ戻し、クリックで実寸⇄フィットを切り替える。
 */
function wireImageZoom(container) {
  const holder = container && container.querySelector('.preview-image');
  if (!holder) return;
  previewZoom.reset();
  applyImageMode(holder);
  // クリック=フィット⇄実寸の切替 / ズーム中のドラッグ=パン（表示位置の移動）。
  // タブ並べ替えと同様に、移動量の閾値でクリックとドラッグを判別する。
  holder.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sc = holder.parentElement; // .preview-content（スクロール容器）
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = sc ? sc.scrollLeft : 0;
    const startTop = sc ? sc.scrollTop : 0;
    const canPan = !previewZoom.isFit() && !!sc;
    let dragging = false;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) >= 4) {
        dragging = true;
        holder.classList.add('panning');
      }
      if (dragging && canPan) {
        sc.scrollLeft = startLeft - dx;
        sc.scrollTop = startTop - dy;
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      holder.classList.remove('panning');
      if (!dragging) {
        previewZoom.toggle();
        applyImageMode(holder);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

/** 表示モードを holder の class と img の幅に反映する（CSS が見た目を担当）。 */
function applyImageMode(holder) {
  const { mode, scale } = previewZoom.get();
  const fit = mode === 'fit';
  holder.classList.toggle('fit', fit);
  holder.classList.toggle('zoom', !fit);
  const img = holder.querySelector('img');
  if (!img) return;
  if (fit) {
    img.style.width = '';
    img.style.height = '';
  } else if (img.naturalWidth) {
    // 実寸(scale=1)基準で拡大縮小。はみ出しは preview-content がスクロール。
    img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
    img.style.height = 'auto';
    // ズーム後は中央を保つ（左上に飛ばない）。scrollWidth の読み取りで
    // レイアウトを確定させてから中央へスクロールする。
    const sc = holder.parentElement; // .preview-content（スクロール容器）
    if (sc) {
      sc.scrollLeft = Math.max(0, (sc.scrollWidth - sc.clientWidth) / 2);
      sc.scrollTop = Math.max(0, (sc.scrollHeight - sc.clientHeight) / 2);
    }
  }
}

/**
 * プレビュー(下配置)の区切りをドラッグして高さを変える (マウス)。
 * 高さは CSS 変数 --preview-h に入れ（grid の該当行が参照）、localStorage に
 * 永続化する。計算とクランプは previewresize.js（純粋）。
 */
function initPreviewResize() {
  const app = document.getElementById('app');
  const divider = document.getElementById('preview-divider');
  const previewEl = document.getElementById('preview');
  if (!app || !divider || !previewEl) return;

  // 保存済みの高さを復元（現在のウィンドウ高さでクランプ）。
  const saved = loadPreviewHeight();
  if (saved != null) {
    app.style.setProperty('--preview-h', `${nextPreviewHeight(saved, 0, 0, window.innerHeight)}px`);
  }

  let startY = 0;
  let startH = 0;
  const heightAt = (clientY) => nextPreviewHeight(startH, startY, clientY, window.innerHeight);
  const onMove = (e) => app.style.setProperty('--preview-h', `${heightAt(e.clientY)}px`);
  const onUp = (e) => {
    divider.removeEventListener('pointermove', onMove);
    divider.removeEventListener('pointerup', onUp);
    try {
      if (e.pointerId != null) divider.releasePointerCapture(e.pointerId);
    } catch {
      /* capture 未対応でも無視 */
    }
    storePreviewHeight(heightAt(e.clientY));
  };
  divider.addEventListener('pointerdown', (e) => {
    if (!app.dataset.preview) return; // プレビューが閉じているときは無視
    e.preventDefault();
    startY = e.clientY;
    startH = previewEl.offsetHeight;
    try {
      if (e.pointerId != null) divider.setPointerCapture(e.pointerId);
    } catch {
      /* capture 未対応でも無視 */
    }
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
  });
}

// Alt 単押しでメニューバーを開く（Fude と同じ操作感）。他キーを挟まず Alt を
// 押して離したときだけ発火する状態機械。
const altTap = createAltTap({ onTap: () => focusMenuBar() });

/** プレビューの開閉/配置を DOM と同期し、永続化する。 */
function syncPreviewPlacement(state) {
  const app = document.getElementById('app');
  if (!app) return;
  if (state.open) {
    app.dataset.preview = 'bottom'; // 配置は下固定（当面）
    const fp = activeFilePane();
    preview.setTarget(fp ? fp.getCursorEntry() : null);
    preview.open();
  } else {
    delete app.dataset.preview;
    preview.close();
  }
  storePlacement(state);
}

// 隠しファイル表示（両ペイン共通, FR-15）
let showHidden = false;

// アプリのバージョン（起動時に取得。ヘルプ表示・更新チェックのメッセージで使う）
let appVer = '';

// 二打鍵プレフィックス待ち（s=並替 / t=タブ / y=コピー / o=開く）。null なら待機なし。
let pendingPrefix = null;

// セッション復元 (FR-14): 各ペインのカレントdir・アクティブペインを保存/復元
const sessionSaver = createSessionSaver({
  getState: () => ({
    dirs: {
      left: filePanes[PANE.LEFT] ? filePanes[PANE.LEFT].getCurrentDir() : null,
      right: filePanes[PANE.RIGHT] ? filePanes[PANE.RIGHT].getCurrentDir() : null,
    },
    active: panes.getActive(),
    // タブ構成 (FR-08/FR-14): 各ペインのタブ dir 一覧とアクティブ index
    tabs: {
      left: paneTabs[PANE.LEFT] ? paneTabs[PANE.LEFT].list().map((t) => t.dir) : null,
      right: paneTabs[PANE.RIGHT] ? paneTabs[PANE.RIGHT].list().map((t) => t.dir) : null,
    },
    activeTab: {
      left: paneTabs[PANE.LEFT] ? paneTabs[PANE.LEFT].activeIndex() : 0,
      right: paneTabs[PANE.RIGHT] ? paneTabs[PANE.RIGHT].activeIndex() : 0,
    },
  }),
  store: storeSession,
});

// ソート状態（両ペイン共通, 詳細表示の並べ替え）
const sortState = createSortState(loadStoredSort());
sortState.subscribe((s) => {
  storeSort(s);
  for (const p of [PANE.LEFT, PANE.RIGHT]) filePanes[p] && filePanes[p].refresh();
  updateStatus();
});

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
  } catch (e) {
    // 存在しない・ディレクトリでない・権限が無い等。OS の理由を添えて、
    // 特にドライブルート（存在しないドライブレター）を分かりやすく示す。
    toast(describeOpenError(target, e));
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

/**
 * OS の既定アプリで開く / ファイルマネージャで表示（デスクトップのみ）。
 * WSL 上では Windows 側へも流せる（起動先の判断は core/wsl.js が持つ）。
 * @param {'open'|'reveal'} kind
 * @param {string} path
 * @param {{name?: string, command: string, target?: string}|string|null} [app]
 *   指定するとこのアプリで開く（FR-13「別のアプリで開く」）。
 *   プログラムを1つ渡すだけで引数は付けられない（extapps.js のコメント参照）。
 * @param {string} [forceTarget] TARGET.LINUX / TARGET.WINDOWS を明示する。
 *   メニューの「〜（Windows）」項目のように、設定に関係なく起動先を固定したいとき用。
 */
async function openWith(kind, path, app, forceTarget) {
  if (!path) return;
  if (!isDesktop()) {
    toast('デスクトップ版でのみ利用できます');
    return;
  }
  const spec = typeof app === 'string' ? { command: app } : app || null;
  const label = spec ? spec.name || spec.command : null;
  const target =
    forceTarget || (spec ? resolveAppTarget(spec, wsl) : resolveDefaultTarget(wslDefaultOpen, wsl));
  try {
    if (target === TARGET.WINDOWS) {
      // WSL → Windows。パス変換と explorer.exe 経由の起動は Rust 側 (wsl.rs)。
      if (kind === 'reveal') await revealInWindows(path);
      else await openInWindows(path, spec ? spec.command : null);
      return;
    }
    const opener = await import('@tauri-apps/plugin-opener');
    if (kind === 'reveal') await opener.revealItemInDir(path);
    else await opener.openPath(path, spec ? spec.command : undefined);
  } catch (e) {
    // 既定アプリの失敗は従来の文言、アプリ指定時は「どのアプリで失敗したか」を出す。
    toast(
      label ? describeAppError(label, e) : '開けませんでした: ' + (e && e.message ? e.message : e),
    );
  }
}

/**
 * 「ファイルマネージャで表示」系のメニュー項目を作る。
 * WSL では Linux 側（xdg 系）と Windows 側（エクスプローラー）の両方を並べる。
 * @param {string} path @param {{currentDir?: boolean}} opts
 */
function revealMenuItems(path, opts = {}) {
  const prefix = opts.currentDir ? '現在地を' : '';
  const defTarget = resolveDefaultTarget(wslDefaultOpen, wsl);
  const otherTarget = defTarget === TARGET.WINDOWS ? TARGET.LINUX : TARGET.WINDOWS;
  const items = [
    {
      label: prefix + openLabel('reveal', defTarget, wsl.available),
      action: () => openWith('reveal', path),
    },
  ];
  if (wsl.available) {
    items.push({
      label: prefix + openLabel('reveal', otherTarget, true),
      action: () => openWith('reveal', path, null, otherTarget),
    });
  }
  return items;
}

/** 起動先を Windows 側に固定して開く（o → w / o → e）。 */
function openOnWindows(kind, path) {
  if (!wsl.available) {
    toast('WSL 環境（Windows 連携が有効なとき）でのみ利用できます');
    return;
  }
  openWith(kind, path, null, TARGET.WINDOWS);
}

/** Windows パスをクリップボードへ（WSL のときだけメニューに出す） */
async function copyWindowsPath(path) {
  if (!path) return;
  try {
    const win = await windowsPath(path);
    if (win) await copyText(win);
    else toast('Windows パスに変換できませんでした');
  } catch (e) {
    toast('Windows パスに変換できませんでした: ' + (e && e.message ? e.message : e));
  }
}

/** 「その他…」: コマンドを都度入力して開く。登録はしない（設定画面で管理する）。 */
async function openWithPrompt(path) {
  if (!path) return;
  const cmd = await promptName('どのアプリで開きますか？（コマンド名 / アプリ名）', '');
  if (cmd == null) return;
  const app = normalizeApp({ command: cmd });
  if (!app) {
    const v = validateApp({ command: cmd });
    toast(v.reason || 'コマンドを入力してください');
    return;
  }
  // target は 'auto'。`notepad.exe` のような指定は WSL なら Windows 側へ流れる。
  await openWith('open', path, app);
}

/**
 * 「別のアプリで開く」の選択メニュー。menu.js はサブメニューを持たないので、
 * 同じ位置に一段掘り下げたメニューを開き直す（キーボード操作は showMenu のまま）。
 * @param {number} x @param {number} y @param {string} path
 */
function showOpenWithMenu(x, y, path, opts = {}) {
  const apps = extApps.list();
  const items = apps.map((a, i) => ({
    // WSL では同じ一覧に Linux 側と Windows 側が混ざるので、どちらで起動するかを見せる。
    label:
      wsl.available && resolveAppTarget(a, wsl) === TARGET.WINDOWS
        ? `${a.name}（Windows）`
        : a.name,
    // 1..9 は二打鍵 o → 数字 と同じスロット。10件目以降はメニューからのみ。
    shortcut: i < QUICK_SLOTS ? `o → ${i + 1}` : '',
    action: () => openWith('open', path, a),
  }));
  if (!items.length) {
    items.push({ label: '（登録された外部アプリはありません）', disabled: true });
  }
  items.push(
    { separator: true },
    { label: 'その他…（コマンドを入力）', shortcut: 'o → a', action: () => openWithPrompt(path) },
    { label: 'アプリを管理…', action: () => openSettingsPanel() },
  );
  showMenu(x, y, items, { focusFirst: opts.focusFirst });
}

/** 二打鍵 o → 1..9。未登録スロットは何が起きたか分かるように理由を出す。 */
function openWithSlot(path, slot) {
  if (!path) return;
  const app = pickByIndex(extApps.list(), slot);
  if (!app) {
    toast(`${slot} 番に外部アプリが登録されていません（設定 → 外部アプリ）`);
    return;
  }
  openWith('open', path, app);
}

/**
 * ファイル一覧の右クリックメニュー (FR-13)。
 * 破壊操作は fileOps 側で安全モードのゲートに掛かる（ここでは隠さず、
 * 押したときに理由がトーストで出るほうが分かりやすい）。
 * @param {string} pane PANE.LEFT / PANE.RIGHT
 * @param {{entry: object|null, x: number, y: number, fromKeyboard?: boolean}} info
 *   fromKeyboard: キーボード（Shift+F10 / メニューキー）から開いたとき。
 *   マウスと違いポインタが項目上に無いので、先頭項目へフォーカスして
 *   矢印キーですぐ操作できるようにする（メニューバーと同じ振る舞い）。
 */
function showEntryMenu(pane, info) {
  const fp = filePanes[pane];
  if (!fp) return;
  const { entry, x, y } = info;
  const destDir = filePanes[panes.getInactive()]?.getCurrentDir();
  const items = [];
  // 選択済みの行を右クリックしたときは選択全体が対象（filepane 側で選択を保つ）。
  // ラベルに件数を出して、何件に効くのかを押す前に分かるようにする。
  const targets = fp.getTargetEntries();
  const n = targets.length;
  const suffix = n > 1 ? `（${n} 件）` : '';

  if (entry) {
    if (entry.is_dir) {
      items.push({ label: '開く', shortcut: 'Enter', action: () => navigateActive(entry.path) });
    } else {
      // WSL では「Linux 側 / Windows 側」の両方を並べる。既定（Enter と同じ動き）が
      // どちらかはラベルで分かるようにし、もう一方も 1 項目だけ添える。
      const defTarget = resolveDefaultTarget(wslDefaultOpen, wsl);
      const otherTarget = defTarget === TARGET.WINDOWS ? TARGET.LINUX : TARGET.WINDOWS;
      items.push({
        label: openLabel('open', defTarget, wsl.available),
        shortcut: 'Enter',
        action: () => openWith('open', entry.path),
      });
      if (wsl.available) {
        items.push({
          label: openLabel('open', otherTarget, true),
          action: () => openWith('open', entry.path, null, otherTarget),
        });
      }
      items.push({
        label: '別のアプリで開く…',
        // 同じ位置に一段掘り下げたメニューを出す（menu.js にサブメニューは無い）。
        // キーボードから開いたときは先頭項目へフォーカスして矢印で選べるようにする。
        action: () => showOpenWithMenu(x, y, entry.path, { focusFirst: !!info.fromKeyboard }),
      });
    }
    items.push(
      ...revealMenuItems(entry.path),
      { separator: true },
      {
        label: `反対のペインへコピー${suffix}`,
        shortcut: 'F5',
        disabled: !destDir,
        action: () => fileOps.copy(targets, destDir),
      },
      {
        label: `反対のペインへ移動${suffix}`,
        shortcut: 'F6',
        disabled: !destDir,
        action: () => fileOps.move(targets, destDir),
      },
      { separator: true },
      // リネームは対象が1つに定まる必要があるので、常にクリックした行のみ
      { label: '名前を変更…', shortcut: 'F2', action: () => fileOps.rename(entry) },
      {
        label: `ゴミ箱へ${suffix}`,
        shortcut: 'Delete',
        danger: true,
        action: () => fileOps.trash(targets),
      },
      {
        label: `完全に削除${suffix}`,
        shortcut: 'Shift+Delete',
        danger: true,
        action: () => fileOps.deletePermanent(targets),
      },
      { separator: true },
      { label: 'パスをコピー', action: () => copyText(entry.path) },
      { label: '名前をコピー', action: () => copyText(entry.name) },
    );
    // WSL では Windows 側に貼れる形（\\wsl.localhost\… / C:\…）も要る
    if (wsl.available) {
      items.push({ label: 'Windows パスをコピー', action: () => copyWindowsPath(entry.path) });
    }
    items.push({ separator: true });
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
    ...revealMenuItems(fp.getCurrentDir(), { currentDir: true }),
  );

  showMenu(x, y, items, { focusFirst: !!info.fromKeyboard });
}

/** 設定画面を開く（すでに開いていれば何もしない） */
function openSettingsPanel() {
  openSettings({
    theme,
    fontScale,
    getShowHidden: () => showHidden,
    setShowHidden,
    extApps,
    wsl,
    // 既定オープン（Enter / ダブルクリック）の行き先。WSL のときだけ設定に出す。
    getDefaultOpen: () => resolveDefaultTarget(wslDefaultOpen, wsl),
    setDefaultOpen: (v) => {
      wslDefaultOpen = v;
      storeDefaultOpen(v);
    },
  });
}

/** 設定画面を開閉する（Ctrl+, とメニューから） */
function toggleSettings() {
  if (isSettingsOpen()) {
    closeSettings();
    return;
  }
  openSettingsPanel();
}

/**
 * メニューバーの定義。items を関数にすると開くたびに現在の状態を反映できる
 * （チェック状態など）。
 */
function buildMenuDefinition() {
  return [
    {
      label: 'ファイル(F)',
      accessKey: 'F',
      items: () => [
        { label: 'お気に入りに現在地を追加', shortcut: 'Ctrl+D', action: addCurrentToFavorites },
        { label: 'ワークスペース…（タブ構成の保存/復元）', action: () => workspacesView.open() },
        { separator: true },
        { label: '終了', action: () => window.close() },
      ],
    },
    {
      label: '編集(E)',
      accessKey: 'E',
      // 対象・宛先の有無で項目を無効化する判定は core/editmenu.js（純粋）に集約。
      // ここでは現在の状態を集めて action を注入するだけ。
      items: () => {
        const fp = activeFilePane();
        const targets = fp ? fp.getTargetEntries() : [];
        return buildEditMenuItems(
          {
            targetCount: targets.length,
            hasDest: !!filePanes[panes.getInactive()]?.getCurrentDir(),
            hasCursor: !!(fp && fp.getCursorEntry()),
          },
          {
            copy: opCopy,
            move: opMove,
            rename: opRename,
            trash: opTrash,
            deletePermanent: opDeletePermanent,
            makeFolder: opMakeFolder,
          },
        );
      },
    },
    {
      label: '表示(V)',
      accessKey: 'V',
      items: () => [
        {
          label: previewPlacement.isOpen() ? '✓ プレビュー' : 'プレビュー',
          shortcut: 'Ctrl+P',
          action: () => previewPlacement.toggle(),
        },
        { separator: true },
        {
          label: showHidden ? '✓ 隠しファイルを表示' : '隠しファイルを表示',
          shortcut: 'Ctrl+H',
          action: toggleHidden,
        },
        { separator: true },
        {
          label: `並び替え（${SORT_LABELS[sortState.get().key]} ${
            sortState.get().dir === 'asc' ? '▲' : '▼'
          }）`,
          disabled: true,
        },
        ...SORT_KEYS.map((k) => ({
          label: `${sortState.get().key === k ? '✓ ' : '　'}${SORT_LABELS[k]}`,
          shortcut: k === 'ext' ? 's e' : `s ${k[0]}`,
          action: () => sortState.applyKey(k),
        })),
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
      label: 'ヘルプ(H)',
      accessKey: 'H',
      items: () => [
        { label: `Tana${appVer ? ' v' + appVer : ''}`, disabled: true },
        { separator: true },
        { label: 'ショートカット一覧', shortcut: '?', action: () => help.toggle() },
        { separator: true },
        {
          label: '更新を確認',
          action: () => checkForUpdates({ manual: true, notify: toast, currentVersion: appVer }),
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

/**
 * Ctrl+ホイールのルーティング。
 * プレビュー画像の上では画像ズーム (FR-16) を優先し、それ以外は文字サイズ
 * 増減 (NFR-U5) に使う。どちらも webview 既定のズームは preventDefault で抑える。
 */
function onWheel(e) {
  const holder = e.target && e.target.closest ? e.target.closest('.preview-image') : null;
  if (holder && e.ctrlKey) {
    const dir = wheelZoomDir(e);
    if (dir) {
      e.preventDefault();
      previewZoom.zoom(dir);
      applyImageMode(holder);
    }
    return;
  }
  const action = wheelFontScaleAction(e);
  if (!action) return;
  e.preventDefault();
  applyFontScale(action);
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
  // プレビューはアクティブペインのカーソルに追従する
  const fp = filePanes[active];
  preview.setTarget(fp ? fp.getCursorEntry() : null);
  sessionSaver.schedule(); // アクティブペインの変更を保存
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
    const picked =
      info && info.selectedCount != null ? info.selectedCount : fp && fp.getSelectedCount();
    const base = count != null ? `${count} 件${name ? ' / ' + name : ''}` : '';
    selEl.textContent = picked > 0 ? `${base}（${picked} 件選択）` : base;
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

// 外部変更の自動反映 (FR-19)。inotify 系はWSL/mnt・ネットワークドライブで届か
// ないことがあるため、ディレクトリ署名を定期比較して変化時のみ再読込する。
const AUTO_REFRESH_MS = 1500;
const polledDir = { left: null, right: null }; // 前回ポーリング時の dir
const polledSig = { left: null, right: null }; // 前回の署名

async function pollPaneOnce(p) {
  const fp = filePanes[p];
  const dir = fp && fp.getCurrentDir();
  if (!dir) return;
  let sig;
  try {
    sig = await dirSignature(dir);
  } catch {
    return; // 取得失敗（消えた等）は次回に任せる
  }
  if (fp.getCurrentDir() !== dir) return; // ポーリング中に移動した
  if (polledDir[p] !== dir) {
    // ディレクトリが変わった直後は基準化のみ（誤再読込を避ける）
    polledDir[p] = dir;
    polledSig[p] = sig;
    return;
  }
  if (sig !== polledSig[p]) {
    polledSig[p] = sig;
    await fp.reload(); // カーソル/選択は保持される
    if (p === panes.getActive()) updateStatus();
  }
}

function startAutoRefresh() {
  setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return; // 非表示中は休む
    pollPaneOnce(PANE.LEFT);
    pollPaneOnce(PANE.RIGHT);
  }, AUTO_REFRESH_MS);
}

/** アクティブペインを手動で再読込する（Ctrl+R）。 */
function reloadActivePane() {
  const fp = activeFilePane();
  if (!fp || !fp.getCurrentDir()) return;
  polledDir[panes.getActive()] = null; // 次のポーリングで基準化し直す
  fp.reload().then(() => {
    if (fp === activeFilePane()) updateStatus();
  });
}

// アクティブペインの選択項目を、非アクティブペインのディレクトリへ
// コピー/移動/削除の対象は「選択があればそれ、無ければカーソル位置の1件」。
// リネームだけは対象が1つに定まる必要があるのでカーソル位置を使う。
function opCopy() {
  const src = activeFilePane();
  const dest = filePanes[panes.getInactive()];
  if (src && dest) fileOps.copy(src.getTargetEntries(), dest.getCurrentDir());
}
function opMove() {
  const src = activeFilePane();
  const dest = filePanes[panes.getInactive()];
  if (src && dest) fileOps.move(src.getTargetEntries(), dest.getCurrentDir());
}
function opTrash() {
  const fp = activeFilePane();
  if (fp) fileOps.trash(fp.getTargetEntries());
}
function opDeletePermanent() {
  const fp = activeFilePane();
  if (fp) fileOps.deletePermanent(fp.getTargetEntries());
}
function opRename() {
  const fp = activeFilePane();
  if (fp) fileOps.rename(fp.getCursorEntry());
}
function opMakeFolder() {
  const fp = activeFilePane();
  if (fp) fileOps.makeNewFolder(fp.getCurrentDir());
}
// ファイルクリップボード操作 (FR-02)。登録（コピー/切り取り）は非破壊なので
// 安全モードでも可。貼り付けの実操作は fileOps 側で安全モードのゲートに掛かる。
function clipboardCopy() {
  const fp = activeFilePane();
  const targets = fp ? fp.getTargetEntries() : [];
  if (!targets.length) return false;
  fileClipboard.copy(targets);
  toast(targets.length === 1 ? 'コピーしました' : `${targets.length} 件をコピー`);
  return true;
}
function clipboardCut() {
  const fp = activeFilePane();
  const targets = fp ? fp.getTargetEntries() : [];
  if (!targets.length) return false;
  fileClipboard.cut(targets);
  toast(targets.length === 1 ? '切り取りました' : `${targets.length} 件を切り取り`);
  return true;
}
function clipboardPaste() {
  if (fileClipboard.isEmpty()) return false;
  const fp = activeFilePane();
  const dir = fp && fp.getCurrentDir();
  if (!dir) return false;
  const { op, entries } = fileClipboard.get();
  if (op === 'move') {
    // 切り取りは一度きり。実行前にクリアして二重貼り付け（元が消えて失敗）を防ぐ。
    fileClipboard.clear();
    fileOps.move(entries, dir);
  } else {
    fileOps.copy(entries, dir);
  }
  return true;
}

function navigateActive(path) {
  const fp = activeFilePane();
  if (fp && path) fp.load(path);
}
function focusActivePane() {
  const el = paneEl(panes.getActive());
  if (el) el.focus();
}
// Ctrl+B でサイドバーのフォーカスを巡回する: ペイン → 場所 → お気に入り → ペイン。
// 場所/お気に入りが空のセクションは飛ばす。
function toggleSidebarFocus() {
  if (placesView && placesView.isFocused()) {
    if (favView && favView.focusFirst && hasFavoriteRows()) favView.focusFirst();
    else focusActivePane();
    return;
  }
  if (favView && favView.isFocused()) {
    focusActivePane();
    return;
  }
  if (placesView) placesView.focusFirst();
  if (placesView && placesView.isFocused()) return;
  if (favView) favView.focusFirst();
}

/** お気に入りに1件以上の行があるか（フォーカス移動先の有無判定に使う） */
function hasFavoriteRows() {
  const el = document.getElementById('favorites');
  return !!(el && el.querySelector('.fav-row'));
}

/** サイドバー（場所 or お気に入り）のいずれかがフォーカス中か */
function sidebarFocused() {
  return !!((placesView && placesView.isFocused()) || (favView && favView.isFocused()));
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
  // ドロップダウンが開いている間はファイラのキー操作をしない（カーソルが動く
  // 等の漏れを防ぐ）。menu.js が ↑↓/Home/End/Enter/Esc を、ここが ←→（隣
  // メニュー）と Alt+文字（隣メニューへ切替）を担当する。判定は menu.js の
  // 実ドロップダウン有無を唯一の真実源にする。
  if (isMenuVisible()) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (moveOpenMenu(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      if (openMenuByAccessKey(e.key)) e.preventDefault();
      return;
    }
    return;
  }
  // 検索オーバーレイ (FR-18): 表示中は Ctrl+F で閉じる以外を searchview に委ねる。
  if (search.isOpen()) {
    if (
      e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      (e.code === 'KeyF' || e.key.toLowerCase() === 'f')
    ) {
      e.preventDefault();
      search.close();
    }
    return;
  }
  // ワークスペース オーバーレイ表示中は本体のキー操作をしない（overlay 側で処理）
  if (workspacesView.isOpen()) return;
  // 検索を開く: Ctrl+F または / （vim 風。入力欄では無効）
  if (
    (e.ctrlKey && !e.altKey && !e.metaKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')) ||
    (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '/' && !isEditableTarget(e.target))
  ) {
    e.preventDefault();
    search.open();
    return;
  }

  // ナビゲーション履歴: Alt+← 戻る / Alt+→ 進む (FR-17)。h(親)/l(開く) とは
  // 別概念（時系列の移動）。ブラウザ/Explorer と同じ操作感。
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    navGo(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  // Alt+文字 で対応するメニューを直接開く（Alt 単押しは altTap 側で処理）。
  // Tana はエディタを持たないので Alt+文字は安全に奪える。
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
    if (openMenuByAccessKey(e.key)) {
      e.preventDefault();
      return;
    }
  }

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
  // タブ (FR-08): Ctrl+Tab 次 / Ctrl+Shift+Tab 前 / Ctrl+T 新規 / Ctrl+W 閉じる
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') {
    e.preventDefault();
    switchTab(panes.getActive(), e.shiftKey ? -1 : 1);
    return;
  }
  if (
    e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !isEditableTarget(e.target) &&
    (e.code === 'KeyT' || e.key.toLowerCase() === 't')
  ) {
    e.preventDefault();
    newTab(panes.getActive());
    return;
  }
  if (
    e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !isEditableTarget(e.target) &&
    (e.code === 'KeyW' || e.key.toLowerCase() === 'w')
  ) {
    e.preventDefault();
    closeTab(panes.getActive());
    return;
  }
  // コンテキストメニュー: Shift+F10 / メニューキー（キーボードからも到達可能に）
  if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
    e.preventDefault();
    const fp = activeFilePane();
    if (fp) {
      const pt = fp.getCursorPoint();
      showEntryMenu(panes.getActive(), {
        entry: fp.getCursorEntry(),
        x: pt.x,
        y: pt.y,
        fromKeyboard: true,
      });
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
  // 全選択: Ctrl+A (FR-11)
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyA' || e.key.toLowerCase() === 'a')) {
    e.preventDefault();
    const fp = activeFilePane();
    if (fp) fp.selectAllEntries();
    return;
  }
  // ファイルクリップボード: Ctrl+C コピー / Ctrl+X 切り取り / Ctrl+V 貼り付け (FR-02)。
  // 入力欄・お気に入りサイドバーにフォーカス中はテキスト編集を優先し横取りしない。
  if (e.ctrlKey && !e.shiftKey && !e.altKey && !isEditableTarget(e.target) && !sidebarFocused()) {
    if (e.code === 'KeyC' || e.key.toLowerCase() === 'c') {
      if (clipboardCopy()) e.preventDefault();
      return;
    }
    if (e.code === 'KeyX' || e.key.toLowerCase() === 'x') {
      if (clipboardCut()) e.preventDefault();
      return;
    }
    if (e.code === 'KeyV' || e.key.toLowerCase() === 'v') {
      if (clipboardPaste()) e.preventDefault();
      return;
    }
  }
  // プレビュー開閉: Ctrl+P (FR-09)。配置は下固定。
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyP' || e.key.toLowerCase() === 'p')) {
    e.preventDefault();
    previewPlacement.toggle();
    return;
  }
  // 手動更新: Ctrl+R（webview の再読込を奪う。自動更新の即時版, FR-19）
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyR' || e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    reloadActivePane();
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
  // サイドバー（場所/お気に入り）がフォーカス中はペイン操作を無効化
  // （操作は placesview / favoritesview 側で処理）
  if (sidebarFocused()) return;

  // ペイン往復: Tab
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    panes.toggle();
    return;
  }

  // 以降はファイルナビゲーション（修飾キー無し・入力欄以外）
  if (e.ctrlKey || e.altKey || e.metaKey || isEditableTarget(e.target)) return;

  // 二打鍵プレフィックス: リーダー(s/t/y/o) に続くキーでアクション確定、他キーで取消
  if (pendingPrefix) {
    e.preventDefault();
    const action = resolvePrefixAction(pendingPrefix, e.key);
    pendingPrefix = null;
    if (action) runPrefixAction(action);
    return;
  }
  if (isPrefixLeader(e.key) && !isEditableTarget(e.target)) {
    e.preventDefault();
    pendingPrefix = e.key.toLowerCase();
    toast(prefixHint(pendingPrefix, { wsl: wsl.available }));
    return;
  }

  const fp = activeFilePane();
  if (!fp) return;

  switch (e.key) {
    case ' ':
      // 選択トグル + カーソルを1つ下へ（連打でまとめて選べる）
      e.preventDefault();
      fp.toggleSelection();
      break;
    case 'Escape':
      // 選択があれば解除。無ければ他のハンドラに任せる
      if (fp.clearSelection()) e.preventDefault();
      break;
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
  // バージョンを取得（デスクトップのみ。失敗しても続行）。
  try {
    appVer = (await appVersion()) || '';
  } catch {
    appVer = '';
  }
  help.setVersion(appVer);
  // ステータスバーの「更新を確認」の横にバージョンを表示（取れたときだけ）
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = appVer ? `v${appVer}` : '';
  theme.subscribe(syncTheme);
  fontScale.subscribe(syncFontScale);
  safemode.subscribe(syncMode);
  panes.subscribe(syncActivePane);
  previewPlacement.subscribe(syncPreviewPlacement);
  document.addEventListener('keydown', onKeydown);
  // Ctrl+ホイールで文字サイズ (NFR-U5)。preventDefault で webview 既定のズームを
  // 抑えるため passive:false が要る。
  document.addEventListener('wheel', onWheel, { passive: false });
  // Alt 単押し検出（keydown/keyup を素通しで監視）。Alt を押している間に他キーが
  // 来たら単押しではないと判断。フォーカスが外れた間の押下は無効（Alt+Tab 対策）。
  window.addEventListener('keydown', (e) => altTap.keydown(e), true);
  window.addEventListener('keyup', (e) => altTap.keyup(e), true);
  window.addEventListener('blur', () => altTap.reset());
  // マウスの戻る/進むボタン (X1=3 / X2=4) でも履歴移動 (FR-17)
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
      e.preventDefault();
      navGo(-1);
    } else if (e.button === 4) {
      e.preventDefault();
      navGo(1);
    }
  });

  // お気に入りサイドバー
  favView = createFavoritesView({
    listEl: document.getElementById('favorites'),
    searchEl: document.getElementById('fav-search'),
    favorites,
    onNavigate: navigateActive,
    onReturn: focusActivePane,
    promptName,
  });
  // 「場所(Places)」サイドバー (FR-07)。起動時に検出して並べる。ドライブや
  // 標準フォルダをクリック / キーボードで開ける（別ドライブへの導線）。
  const placesEl = document.getElementById('places');
  if (placesEl) {
    placesView = createPlacesView({
      listEl: placesEl,
      onNavigate: navigateActive,
      onReturn: focusActivePane,
    });
    listPlaces()
      .then((places) => placesView.render(places))
      .catch(() => placesView.render([]));
  }

  // WSL 連携の可否を確認 (FR-13)。失敗しても「使えない」に倒すだけで起動は妨げない。
  wslInfo()
    .then((info) => {
      wsl = normalizeInfo(info);
    })
    .catch(() => {
      wsl = { ...NO_WSL };
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
      getSort: () => sortState.get(),
      onSort: (key) => sortState.applyKey(key),
      onActivate: () => panes.setActive(p),
      onNavigate: (value, o) => navigatePane(p, value, o),
      onContextMenu: (info) => showEntryMenu(p, info),
      onDragStart: (info) => dragSession.begin(info),
      onOpenFile: (entry) => openWith('open', entry.path),
      onChange: (info) => {
        recordNav(p, info.dir); // 履歴へ (FR-17)。dir 変化時のみ積む
        syncActiveTab(p, info.dir); // アクティブタブの dir 追従 (FR-08)
        sessionSaver.schedule(); // ディレクトリ移動をセッションに保存（デバウンス）
        if (p === panes.getActive()) {
          updateStatus(info);
          preview.setTarget(info.entry); // カーソル追従（閉じていれば記録のみ）
        }
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

  // プレビューを閉じる（マウス操作用の ✕ ボタン）
  const previewCloseBtn = document.getElementById('preview-close');
  if (previewCloseBtn) {
    previewCloseBtn.addEventListener('click', () => previewPlacement.close());
  }

  // プレビュー縦幅のマウスリサイズ（区切りドラッグ）
  initPreviewResize();

  // 起動ディレクトリ: CLI 引数 > セッション復元(FR-14) > ホーム
  const cli = await getCliPath();
  const home = (await homeDir()) || '.';
  const loadOr = async (fp, dir) => {
    try {
      await fp.load(dir || home);
    } catch {
      // 存在しなくなったパス等はホームへフォールバック（堅牢性）
      await fp.load(home);
    }
  };
  let session = null;
  if (cli) {
    await Promise.all([loadOr(filePanes.left, cli), loadOr(filePanes.right, cli)]);
  } else {
    session = loadSession();
    await Promise.all([
      loadOr(filePanes.left, session && session.dirs.left),
      loadOr(filePanes.right, session && session.dirs.right),
    ]);
    if (session && session.active === PANE.RIGHT) panes.setActive(PANE.RIGHT);
  }
  updateStatus();

  // タブ (FR-08/FR-14): セッションにタブ構成があれば復元、無ければ起動 dir で単一タブ。
  for (const p of [PANE.LEFT, PANE.RIGHT]) {
    const fp = filePanes[p];
    if (!fp) continue;
    const savedTabs = session && session.tabs ? session.tabs[p] : null;
    if (Array.isArray(savedTabs) && savedTabs.length > 1) {
      // 複数タブを復元。アクティブタブの dir は起動時にロード済みとは限らないので
      // 必要なら読み直す。存在しない dir は loadOr がホームへ倒す。
      paneTabs[p] = createTabList(savedTabs[0]);
      for (let i = 1; i < savedTabs.length; i++) paneTabs[p].add(savedTabs[i]);
      const idx = Math.min((session.activeTab && session.activeTab[p]) || 0, savedTabs.length - 1);
      paneTabs[p].activate(idx);
      const activeDir = paneTabs[p].active().dir;
      if (activeDir !== fp.getCurrentDir()) await loadOr(fp, activeDir);
      // ロード後の実 dir をアクティブタブへ反映（フォールバックされた場合の齟齬回避）
      paneTabs[p].setActiveDir(fp.getCurrentDir());
    } else {
      paneTabs[p] = createTabList(fp.getCurrentDir());
    }
    renderTabs(p);
  }
  updateStatus();

  // 外部変更の自動反映を開始 (FR-19)
  startAutoRefresh();

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
