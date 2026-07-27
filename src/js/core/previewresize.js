// previewresize.js — プレビュー(下配置)の高さリサイズの純粋ロジック + 永続化
//
// ドラッグ計算と localStorage の入出力だけを扱い、DOM 操作は app 側。
// プレビューはワークスペースの下に置くので、区切りを「上」へドラッグすると
// 高くなる（startY - curY が増分）。min と 画面高さ*maxFrac でクランプする。

export const PREVIEW_H = { MIN: 120, MAX_FRAC: 0.75, KEY: 'tana.previewHeight' };

/**
 * ドラッグ中の新しいプレビュー高さ(px)。
 * @param {number} startHeight ドラッグ開始時のプレビュー高さ(px)
 * @param {number} startY 開始時のポインタ Y
 * @param {number} curY 現在のポインタ Y
 * @param {number} viewportH ウィンドウ高さ(px)
 * @param {{min?:number, maxFrac?:number}} [opts]
 */
export function nextPreviewHeight(startHeight, startY, curY, viewportH, opts = {}) {
  const min = opts.min ?? PREVIEW_H.MIN;
  const maxFrac = opts.maxFrac ?? PREVIEW_H.MAX_FRAC;
  const max = Math.max(min, Math.floor((viewportH || 0) * maxFrac));
  const raw = startHeight + (startY - curY); // 上へ動かすと高くなる
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function safeLocal() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 保存済み高さ(px)を返す。無効/未保存は null。 */
export function loadPreviewHeight(store = safeLocal()) {
  const v = store ? store.getItem(PREVIEW_H.KEY) : null;
  const n = v == null ? NaN : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 高さ(px)を保存する。 */
export function storePreviewHeight(px, store = safeLocal()) {
  if (store && Number.isFinite(px)) store.setItem(PREVIEW_H.KEY, String(Math.round(px)));
}
