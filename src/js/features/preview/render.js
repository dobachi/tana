// features/preview/render.js — 形式別レンダラ (FR-09 段階2: 画像/テキスト/メタ)
// 遅延ロードされる（NFR-P2）。DOM を触るが Tauri には依存せず、doc を注入可能に
// してテストできる。Markdown レンダリングは段階3で別チャンクとして追加する。

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

/** メタ情報カード（フォルダ/未対応/上限超過/エラー/空）。必ず何か出す（PV-5）。 */
export function renderMeta(container, { entry, kind, note }, doc) {
  container.innerHTML = '';
  const card = el(doc, 'div', 'preview-meta');
  card.appendChild(el(doc, 'div', 'preview-meta-name', entry?.name || '—'));
  const kindLabel = KIND_LABEL[kind] || '不明';
  const rows = [
    ['種別', kindLabel],
    ['サイズ', entry?.is_dir ? '—' : formatSize(entry?.size)],
    ['更新', formatMtime(entry?.modified)],
    ['パス', entry?.path || '—'],
  ];
  const dl = el(doc, 'dl', 'preview-meta-list');
  for (const [k, v] of rows) {
    dl.appendChild(el(doc, 'dt', null, k));
    dl.appendChild(el(doc, 'dd', null, v));
  }
  card.appendChild(dl);
  if (note) card.appendChild(el(doc, 'p', 'preview-meta-note', note));
  container.appendChild(card);
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
