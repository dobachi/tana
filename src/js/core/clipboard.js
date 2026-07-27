// clipboard.js — ファイルクリップボードの状態（純粋・DOM/Tauri 非依存）。
//
// Ctrl+C=コピー / Ctrl+X=切り取り（移動）で対象を登録し、Ctrl+V の貼り付けで
// 現在地へ渡す。ここが保持するのは「エントリ（{ path, name, ... }）の配列」と
// 操作種別（'copy' | 'move'）だけ。実際のコピー/移動は fileops、貼り付け先の
// 決定は app.js が担う。fileops.copy/move はエントリ配列を受け取るので、
// パス文字列ではなくエントリをそのまま保持する。

export function createFileClipboard() {
  let op = null; // 'copy' | 'move' | null
  let entries = []; // 対象エントリ配列

  /** null / 単体 / 配列を「path を持つエントリ」の配列に正規化する */
  function normalize(list) {
    if (!list) return [];
    const arr = Array.isArray(list) ? list : [list];
    return arr.filter((e) => e && e.path);
  }

  function set(nextOp, list) {
    const next = normalize(list);
    if (next.length) {
      op = nextOp;
      entries = next;
    } else {
      // 空の登録は「クリップボードなし」に倒す（空で貼り付け不能にするため）
      op = null;
      entries = [];
    }
  }

  return {
    /** 選択をコピー登録（貼り付け後も残す＝複数回貼れる） */
    copy: (list) => set('copy', list),
    /** 選択を切り取り登録（貼り付け後にクリアする＝一度きり） */
    cut: (list) => set('move', list),
    /** 現在の状態。entries は複製を返し、外からの変更を防ぐ */
    get: () => ({ op, entries: entries.slice() }),
    isEmpty: () => entries.length === 0,
    count: () => entries.length,
    clear: () => {
      op = null;
      entries = [];
    },
  };
}
