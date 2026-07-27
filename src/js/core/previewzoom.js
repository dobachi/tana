// previewzoom.js — プレビュー画像の表示モードの純粋な状態 (FR-16)
//
// mode: 'fit'（ペインに収める＝縦横フィット, 既定）| 'zoom'（倍率指定）。
// zoom の scale は実寸基準（1 = 原寸 100%）。DOM を持たず状態遷移と倍率の
// クランプだけを扱うのでそのままテストできる。実際の <img> への適用
// （object-fit / width=naturalWidth*scale）は view 側。

export const ZOOM = { MIN: 0.1, MAX: 8, STEP: 1.25 };

/** 倍率を [min, max] に収める。非数は 1 に倒す。 */
export function clampScale(scale, min = ZOOM.MIN, max = ZOOM.MAX) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(max, Math.max(min, scale));
}

/** ホイールのズーム方向（上=拡大 +1 / 下=縮小 -1 / それ以外 0）。 */
export function wheelZoomDir(e) {
  if (!e) return 0;
  if (e.deltaY < 0) return 1;
  if (e.deltaY > 0) return -1;
  return 0;
}

export function createPreviewZoom(opts = {}) {
  const min = opts.min ?? ZOOM.MIN;
  const max = opts.max ?? ZOOM.MAX;
  const step = opts.step ?? ZOOM.STEP;

  let mode = 'fit'; // 'fit' | 'zoom'
  let scale = 1;

  return {
    /** 現在の状態 { mode, scale } */
    get: () => ({ mode, scale }),
    isFit: () => mode === 'fit',
    /** 新しい画像を表示するたびにフィットへ戻す */
    reset: () => {
      mode = 'fit';
      scale = 1;
    },
    /** フィット ⇄ 実寸(100%) を切り替え、切替後のモードを返す */
    toggle: () => {
      mode = mode === 'fit' ? 'zoom' : 'fit';
      scale = 1;
      return mode;
    },
    /**
     * 方向 dir（+1 拡大 / -1 縮小）に 1 段ズームする。フィット中は実寸(1.0)を
     * 起点にズームへ移る。クランプ後の scale を返す。
     */
    zoom: (dir) => {
      const base = mode === 'fit' ? 1 : scale;
      mode = 'zoom';
      scale = clampScale(base * Math.pow(step, dir), min, max);
      return scale;
    },
  };
}
