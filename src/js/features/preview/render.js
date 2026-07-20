// features/preview/render.js — 形式別レンダラ + ファイル情報パネル (FR-09)
// 遅延ロードされる（NFR-P2）。DOM を触るが Tauri には依存せず、doc を注入可能に
// してテストできる。プレビュー領域は「内容(左)」と「情報パネル(右)」の2つ。

import { KIND } from '../../core/previewkind.js';

/** バイト数を人間可読に整形する。 */
export function formatSize(bytes) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return i === 0 ? `${n} ${units[i]}` : `${n.toFixed(1)} ${units[i]}`;
}

/** エポック秒を YYYY-MM-DD HH:MM に整形する（ローカル時刻）。 */
export function formatMtime(secs) {
  if (secs == null) return '—';
  const d = new Date(secs * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

const KIND_LABEL = {
  [KIND.DIR]: 'フォルダ',
  [KIND.IMAGE]: '画像',
  [KIND.TEXT]: 'テキスト',
  [KIND.MARKDOWN]: 'Markdown',
  [KIND.PDF]: 'PDF',
  [KIND.BINARY]: 'バイナリ',
  [KIND.TOO_LARGE]: '大きすぎるファイル',
  [KIND.EMPTY]: '空ファイル',
};

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * ファイル情報パネル（プレビューの右）。常に表示し、名前・種別・サイズ・更新・
 * パスと、種別ごとの追加情報（画像=寸法、テキスト=エンコード/切り詰め）を出す。
 * @param {HTMLElement} container
 * @param {{entry:object, kind:string, data?:object, src?:string}} arg
 * @param {Document} doc
 */
export function renderInfo(container, { entry, kind, data, src }, doc) {
  container.innerHTML = '';
  if (!entry) return;
  container.appendChild(el(doc, 'div', 'preview-info-name', entry.name || '—'));

  const dl = el(doc, 'dl', 'preview-info-list');
  const add = (k, v) => {
    dl.appendChild(el(doc, 'dt', null, k));
    return dl.appendChild(el(doc, 'dd', null, v));
  };
  add('種別', KIND_LABEL[kind] || '不明');
  add('サイズ', entry.is_dir ? '—' : formatSize(entry.size));
  add('更新', formatMtime(entry.modified));

  // 種別ごとの追加情報
  let dimDd = null;
  if (kind === KIND.IMAGE) dimDd = add('寸法', '…');
  if ((kind === KIND.TEXT || kind === KIND.MARKDOWN) && data) {
    if (data.encoding) add('エンコード', data.encoding);
    if (data.truncated) add('表示', '先頭のみ');
  }
  container.appendChild(dl);

  // パスは長いので全幅で最後に
  const pathBox = el(doc, 'div', 'preview-info-path');
  pathBox.appendChild(el(doc, 'div', 'preview-info-path-label', 'パス'));
  pathBox.appendChild(el(doc, 'div', 'preview-info-path-value', entry.path || '—'));
  container.appendChild(pathBox);

  // 画像は寸法を非同期に取得（asset を再ロードするがブラウザキャッシュに載る）。
  // 情報パネルが差し替えられていたら（dimDd が切断）反映しない。
  if (kind === KIND.IMAGE && src && dimDd) {
    const probe = doc.createElement('img');
    probe.addEventListener('load', () => {
      if (dimDd.isConnected) dimDd.textContent = `${probe.naturalWidth} × ${probe.naturalHeight}`;
    });
    probe.addEventListener('error', () => {
      if (dimDd.isConnected) dimDd.textContent = '—';
    });
    probe.src = src;
  }
}

/** 非プレビュー種別（フォルダ/バイナリ/上限超過/空/エラー）の内容側の短い表示。 */
export function renderPlaceholder(container, { kind, note }, doc) {
  container.innerHTML = '';
  const box = el(doc, 'div', 'preview-placeholder');
  box.appendChild(el(doc, 'div', 'preview-placeholder-kind', KIND_LABEL[kind] || '—'));
  if (note) box.appendChild(el(doc, 'div', 'preview-placeholder-note', note));
  container.appendChild(box);
}

/** 画像プレビュー（asset URL を <img> で表示。バイト列は読まない）。 */
export function renderImage(container, { entry, src }, doc) {
  container.innerHTML = '';
  const holder = el(doc, 'div', 'preview-image');
  const img = doc.createElement('img');
  img.src = src;
  img.alt = entry?.name || '';
  img.loading = 'lazy';
  holder.appendChild(img);
  container.appendChild(holder);
}

/** テキストプレビュー（textContent に流すのみ。innerHTML は使わない）。 */
export function renderText(container, { data }, doc) {
  container.innerHTML = '';
  const pre = el(doc, 'pre', 'preview-text');
  pre.textContent = (data && data.text) || '';
  container.appendChild(pre);
  if (data && data.truncated) {
    container.appendChild(el(doc, 'p', 'preview-truncated', '先頭のみ表示（以降は省略）'));
  }
}
