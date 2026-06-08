// filepane.js — 1ペインのファイル一覧コントローラ (FR-01)
// ディレクトリの読み込み・描画・カーソル移動・階層ナビゲーション(h/l)を担う。

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

/**
 * ファイルペインを生成する。
 * @param {HTMLElement} rootEl `.pane` 要素（`.pane-list` と `.pane-path` を含む）
 * @param {object} opts
 * @param {() => void} [opts.onActivate] このペインがクリックされたとき
 * @param {(info: {dir: string, entry: object|null, count: number}) => void} [opts.onChange] 状態変化時
 */
export function createFilePane(rootEl, opts = {}) {
  const listEl = rootEl.querySelector('.pane-list');
  const pathEl = rootEl.querySelector('.pane-path');
  const { onActivate, onChange } = opts;

  let currentDir = null;
  let entries = [];
  let cursor = 0;

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
      li.className = 'entry' + (e.is_dir ? ' is-dir' : '') + (i === cursor ? ' cursor' : '');
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
    const list = await listDir(dir);
    currentDir = dir;
    entries = list;
    cursor = clampCursor(cursorTo, entries.length);
    render();
    notify();
  }

  /** カーソルを delta 行移動 */
  function moveCursor(delta) {
    const next = clampCursor(cursor + delta, entries.length);
    if (next !== cursor) {
      cursor = next;
      render();
      notify();
    }
  }

  /** カーソルを先頭/末尾へ */
  function moveCursorTo(pos) {
    const next = pos === 'top' ? 0 : entries.length - 1;
    cursor = clampCursor(next, entries.length);
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
    getCurrentDir: () => currentDir,
    getCursorEntry: () => entries[cursor] || null,
    getCount: () => entries.length,
  };
}
