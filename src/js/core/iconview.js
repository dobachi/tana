// iconview.js — 一覧の「アイコン表示」（写真のタイル並び）の純粋な部分。DOM 非依存。
//
// 表示の種類（詳細 / アイコン）はペインごと、タイルの大きさは全ペイン共通で、どちらも
// localStorage に保存する。カーソルの上下左右の移動先と、タイルの大きさに合う縮小画像の
// 大きさもここで決める。描画は filepane.js。

export const VIEW = Object.freeze({ DETAILS: 'details', ICONS: 'icons' });
export const VIEW_KEY_PREFIX = 'tana.view.'; // + 'left' / 'right'
export const ICON_SIZE_KEY = 'tana.iconview.size';

/** タイルの大きさの段階。em は縮小画像の枠の一辺（文字の大きさに合わせて伸び縮みする） */
export const ICON_SIZES = Object.freeze([
  Object.freeze({ label: '小', em: 3 }),
  Object.freeze({ label: '中', em: 4.5 }),
  Object.freeze({ label: '大', em: 6.5 }),
  Object.freeze({ label: '特大', em: 9 }),
]);
export const DEFAULT_ICON_SIZE = 1;

/** Rust に頼める縮小画像の大きさ（長い辺の px）。thumbs.rs の上限 256 まで */
export const THUMB_TIERS = Object.freeze([64, 128, 256]);

/** 壊れた値を表示の種類に直す（既定は詳細） */
export function normalizeView(v) {
  return v === VIEW.ICONS ? VIEW.ICONS : VIEW.DETAILS;
}

/** 大きさの段階を範囲内の整数にする */
export function clampIconSize(i) {
  const n = Number.parseInt(i, 10);
  if (!Number.isFinite(n)) return DEFAULT_ICON_SIZE;
  return Math.min(ICON_SIZES.length - 1, Math.max(0, n));
}

/** 1 段大きく(+1) / 小さく(-1) */
export function stepIconSize(i, dir) {
  return clampIconSize(clampIconSize(i) + (dir > 0 ? 1 : dir < 0 ? -1 : 0));
}

export function loadView(pane, storage = globalThis.localStorage) {
  try {
    return normalizeView(storage && storage.getItem(VIEW_KEY_PREFIX + pane));
  } catch {
    return VIEW.DETAILS;
  }
}

export function storeView(pane, view, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(VIEW_KEY_PREFIX + pane, normalizeView(view));
  } catch {
    // 保存できなくても今回の切替は効かせる
  }
}

export function loadIconSize(storage = globalThis.localStorage) {
  try {
    const v = storage && storage.getItem(ICON_SIZE_KEY);
    return v == null ? DEFAULT_ICON_SIZE : clampIconSize(v);
  } catch {
    return DEFAULT_ICON_SIZE;
  }
}

export function storeIconSize(i, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(ICON_SIZE_KEY, String(clampIconSize(i)));
  } catch {
    // 同上
  }
}

/**
 * 表示上の大きさ（CSS px）と画面の倍率から、粗く見えない最小の縮小画像の大きさを選ぶ。
 * @param {number} cssPx 枠の一辺
 * @param {number} [dpr] window.devicePixelRatio
 */
export function thumbPxFor(cssPx, dpr = 1) {
  const need = Math.ceil((Number(cssPx) || 0) * (Number(dpr) > 0 ? Number(dpr) : 1));
  return THUMB_TIERS.find((t) => t >= need) || THUMB_TIERS[THUMB_TIERS.length - 1];
}

/**
 * 1 段に並ぶタイルの数。各タイルの上端の位置（並び順）から、先頭と同じ段にある数を数える。
 * 測れない（空・レイアウト前）ときは 1。
 * @param {number[]} tops
 */
export function columnsFromTops(tops) {
  if (!Array.isArray(tops) || !tops.length) return 1;
  let n = 0;
  while (n < tops.length && Math.abs(tops[n] - tops[0]) < 1) n += 1;
  return Math.max(1, n);
}

/**
 * アイコン表示でのカーソルの移動先。
 * left/right は前後の 1 つ（段の端では次の段へ続く）、up/down は 1 段上下。
 * 下の段が短くて真下が無ければ、その段の最後へ。範囲外へは出ない。
 * @param {number} index 今の位置
 * @param {'left'|'right'|'up'|'down'} dir
 * @param {number} cols 1 段の数
 * @param {number} len 全体の数
 */
export function gridMove(index, dir, cols, len) {
  if (len <= 0) return 0;
  const c = Math.max(1, Math.floor(cols) || 1);
  const i = Math.min(len - 1, Math.max(0, index));
  switch (dir) {
    case 'left':
      return Math.max(0, i - 1);
    case 'right':
      return Math.min(len - 1, i + 1);
    case 'up':
      return i - c >= 0 ? i - c : i;
    case 'down': {
      if (i + c < len) return i + c;
      // 下に段があれば（短い段）その最後へ。最後の段なら動かない
      const lastRowStart = Math.floor((len - 1) / c) * c;
      return i < lastRowStart ? len - 1 : i;
    }
    default:
      return i;
  }
}

/** 写真の無いタイルに出す印 */
export function glyphFor(entry) {
  if (!entry) return '';
  if (entry.is_parent) return '⬆';
  if (entry.is_dir) return '📁';
  return '📄';
}
