// filepane.js — 1ペインのファイル一覧コントローラ (FR-01)
// ディレクトリの読み込み・描画・カーソル移動・階層ナビゲーション(h/l)・隠しファイル表示切替(FR-15)。

import { listDir, parentDir } from '../backend.js';

/** バイト数を人間可読なサイズ文字列にする */
export function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return (i === 0 ? n : n.toFixed(1)) + units[i];
}

/** カーソル位置を [0, len-1] にクランプする */
export function clampCursor(idx, len) {
  if (len <= 0) return 0;
  if (idx < 0) return 0;
  if (idx >= len) return len - 1;
  return idx;
}

/** エントリが隠しか（バックエンドの is_hidden、無ければ先頭ドットで判定） */
export function isHidden(entry) {
  if (typeof entry.is_hidden === 'boolean') return entry.is_hidden;
  return typeof entry.name === 'string' && entry.name.startsWith('.');
}

/** showHidden に応じて表示対象のエントリを返す */
export function filterEntries(entries, showHidden) {
  return showHidden ? entries : entries.filter((e) => !isHidden(e));
}

/**
 * ファイルペインを生成する。
 * @param {HTMLElement} rootEl `.pane` 要素（`.pane-list` と `.pane-path` を含む）
 * @param {object} opts
 * @param {() => void} [opts.onActivate] このペインがクリックされたとき
 * @param {(info: {dir: string, entry: object|null, count: number}) => void} [opts.onChange]
 * @param {boolean} [opts.showHidden] 隠しファイルを表示するか（初期値）
 */
export function createFilePane(rootEl, opts = {}) {
  const listEl = rootEl.querySelector('.pane-list');
  const pathEl = rootEl.querySelector('.pane-path');
  const { onActivate, onChange } = opts;

  let currentDir = null;
  let allEntries = []; // 読み込んだ全件
  let entries = []; // 表示対象（フィルタ後）
  let cursor = 0;
  let showHidden = opts.showHidden === true;

  function recompute(keepPath) {
    entries = filterEntries(allEntries, showHidden);
    // フィルタ前後でカーソル対象を維持できれば維持、できなければクランプ
    if (keepPath) {
      const idx = entries.findIndex((e) => e.path === keepPath);
      cursor = idx >= 0 ? idx : clampCursor(cursor, entries.length);
    } else {
      cursor = clampCursor(cursor, entries.length);
    }
  }

  function notify() {
    if (pathEl) pathEl.textContent = currentDir || '—';
    if (onChange) {
      onChange({ dir: currentDir, entry: entries[cursor] || null, count: entries.length });
    }
  }

  function render() {
    listEl.replaceChildren();
    entries.forEach((e, i) => {
      const li = document.createElement('li');
      const hiddenCls = isHidden(e) ? ' is-hidden' : '';
      li.className =
        'entry' + (e.is_dir ? ' is-dir' : '') + hiddenCls + (i === cursor ? ' cursor' : '');
      const name = document.createElement('span');
      name.className = 'entry-name';
      name.textContent = e.is_dir ? e.name + '/' : e.name;
      const size = document.createElement('span');
      size.className = 'entry-size';
      size.textContent = e.is_dir ? '' : formatSize(e.size);
      li.append(name, size);
      li.addEventListener('mousedown', () => {
        if (onActivate) onActivate();
        cursor = i;
        render();
        notify();
      });
      li.addEventListener('dblclick', () => {
        cursor = i;
        enter();
      });
      listEl.appendChild(li);
    });
    const cur = listEl.children[cursor];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  /** ディレクトリを読み込んで表示する */
  async function load(dir, cursorTo = 0) {
    allEntries = await listDir(dir);
    currentDir = dir;
    recompute();
    cursor = clampCursor(cursorTo, entries.length);
    render();
    notify();
  }

  /** 隠しファイルの表示/非表示を設定（FR-15） */
  function setShowHidden(next) {
    const v = next === true;
    if (v === showHidden) return;
    showHidden = v;
    const keep = entries[cursor] ? entries[cursor].path : null;
    recompute(keep);
    render();
    notify();
  }

  function moveCursor(delta) {
    const next = clampCursor(cursor + delta, entries.length);
    if (next !== cursor) {
      cursor = next;
      render();
      notify();
    }
  }

  function moveCursorTo(pos) {
    cursor = clampCursor(pos === 'top' ? 0 : entries.length - 1, entries.length);
    render();
    notify();
  }

  /** カーソル位置がディレクトリなら入る (l / Enter) */
  async function enter() {
    const e = entries[cursor];
    if (e && e.is_dir) await load(e.path);
  }

  /** 親ディレクトリへ戻る (h / Backspace)。元いたフォルダにカーソルを合わせる */
  async function goParent() {
    if (!currentDir) return;
    const parent = await parentDir(currentDir);
    if (!parent || parent === currentDir) return;
    const from = currentDir;
    await load(parent);
    const idx = entries.findIndex((e) => e.path === from);
    if (idx >= 0) {
      cursor = idx;
      render();
      notify();
    }
  }

  return {
    el: rootEl,
    load,
    moveCursor,
    moveCursorTo,
    enter,
    goParent,
    setShowHidden,
    isShowingHidden: () => showHidden,
    getCurrentDir: () => currentDir,
    getCursorEntry: () => entries[cursor] || null,
    getCount: () => entries.length,
  };
}
