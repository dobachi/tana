// previewzoom.js — プレビュー画像の表示モードの純粋な状態 (FR-16)
//
// mode: 'fit'（ペインに収める＝縦横フィット, 既定）| 'actual'（実寸 100%）。
// DOM を持たず状態遷移だけを扱うのでそのままテストできる。実際の <img> への
// 適用（object-fit / スクロール）は view 側。連続ズーム・パンは次段階で拡張する。

export function createPreviewZoom() {
  let mode = 'fit';

  return {
    /** 現在のモード: 'fit' | 'actual' */
    get: () => mode,
    isFit: () => mode === 'fit',
    /** 新しい画像を表示するたびにフィットへ戻す */
    reset: () => {
      mode = 'fit';
    },
    /** フィット ⇄ 実寸 を切り替え、切替後のモードを返す */
    toggle: () => {
      mode = mode === 'fit' ? 'actual' : 'fit';
      return mode;
    },
  };
}
