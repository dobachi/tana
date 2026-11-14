// crumbfit.js — ブレッドクラムが入り切らないとき、途中の階層を「…」にまとめる範囲を決める。
// 右端（現在地）を CSS で切り落とすと一番知りたい場所が見えなくなるため、
// 先頭（ルート/ドライブ）と末尾側を残し、2 番目から順に必要な分だけ畳む。
// DOM 非依存の純粋関数。幅の実測は呼び出し側（filepane.js）が行う。

/**
 * 畳むセグメントの範囲を返す。
 * @param {number[]} widths 各セグメントの幅（直前の区切り記号を含む）。先頭が [0]
 * @param {number} available 表示に使える幅
 * @param {number} ellipsisWidth 「…」（直前の区切り記号を含む）の幅
 * @returns {{from: number, to: number} | null} 隠す範囲 [from, to)。畳む必要が無ければ null
 */
export function crumbCollapseRange(widths, available, ellipsisWidth) {
  if (!Array.isArray(widths) || !(available > 0)) return null;
  const n = widths.length;
  const total = widths.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (total <= available) return null;
  // 先頭と末尾は必ず残す。間が無ければ畳めない（末尾の切り落としは CSS に任せる）
  if (n < 3) return null;
  const e = ellipsisWidth > 0 ? ellipsisWidth : 0;
  let hidden = 0;
  for (let to = 2; to <= n - 1; to += 1) {
    hidden += widths[to - 1] > 0 ? widths[to - 1] : 0;
    if (total - hidden + e <= available) return { from: 1, to };
  }
  // どこまで畳んでも入らないときは最大限畳む（先頭 … 末尾）
  return { from: 1, to: n - 1 };
}

/**
 * パス文字列の途中の階層を k 個「…」にまとめる（ステータスバー等の 1 行表示用）。
 * 先頭（ルート/ドライブ/ホスト）と末尾は残す。畳めない・k<=0 ならそのまま返す。
 * @param {string} text 区切りが / のパス
 * @param {number} k 畳む階層の数（多すぎるときは畳める最大まで）
 * @returns {string}
 */
export function collapsePathText(text, k) {
  if (typeof text !== 'string' || !(k > 0)) return text;
  const parts = text.split('/');
  // 末尾の / は畳み判定から外して最後に戻す
  const trailing = parts.length > 1 && parts[parts.length - 1] === '' ? parts.pop() : null;
  const max = parts.length - 2;
  if (max < 1) return text;
  const n = Math.min(Math.floor(k), max);
  const out = [parts[0], '…', ...parts.slice(1 + n)].join('/');
  return trailing === null ? out : `${out}/`;
}

/** collapsePathText で畳める最大の階層数 */
export function maxPathCollapse(text) {
  if (typeof text !== 'string') return 0;
  const parts = text.split('/');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return Math.max(0, parts.length - 2);
}
