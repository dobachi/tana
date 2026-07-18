// selection.js — ファイル一覧の複数選択（FR-11）
//
// 選択は「パスの Set」で保持する。インデックスで持つと、ディレクトリの再読込・
// 隠しファイル表示の切替・フィルタで並びが変わったときに選択が別のファイルへ
// ずれてしまうため。カーソル維持が keepPath でパスを見ているのと同じ考え方。
//
// UI 非依存の純粋関数の集まりで、DOM も Tauri も参照しない。

/**
 * クリック操作から次の選択状態を求める。
 *
 * 一般的なファイラの慣習に合わせる:
 *   通常クリック   … その1件だけを選択（他は解除）
 *   Ctrl+クリック  … その1件をトグル（他は維持）
 *   Shift+クリック … アンカーからクリック位置までの範囲を選択
 *
 * @param {object} state 現在の状態
 * @param {string[]} state.paths 表示順のパス配列
 * @param {Set<string>} state.selected 現在の選択
 * @param {number} state.anchor 範囲選択の起点インデックス（-1 で未設定）
 * @param {number} index クリックされた位置
 * @param {{ctrl?: boolean, shift?: boolean}} [mods] 修飾キー
 * @returns {{selected: Set<string>, anchor: number}} 次の選択とアンカー
 */
export function applyClick(state, index, mods = {}) {
  const { paths, selected, anchor } = state;
  if (index < 0 || index >= paths.length) {
    return { selected: new Set(selected), anchor };
  }
  const path = paths[index];

  if (mods.shift) {
    // Shift はアンカー起点。アンカー未設定ならクリック位置を起点にする。
    const from = anchor >= 0 && anchor < paths.length ? anchor : index;
    return { selected: new Set(rangePaths(paths, from, index)), anchor: from };
  }
  if (mods.ctrl) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    // トグルした位置を次の Shift の起点にする
    return { selected: next, anchor: index };
  }
  return { selected: new Set([path]), anchor: index };
}

/** from..to（順不同）の範囲に含まれるパスを返す */
export function rangePaths(paths, from, to) {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(paths.length - 1, Math.max(from, to));
  if (hi < lo) return [];
  return paths.slice(lo, hi + 1);
}

/** カーソル位置の選択をトグルする（Space 用） */
export function toggleAt(selected, paths, index) {
  const next = new Set(selected);
  if (index < 0 || index >= paths.length) return next;
  const path = paths[index];
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** 表示中の全件を選択する（Ctrl+A 用） */
export function selectAll(paths) {
  return new Set(paths);
}

/**
 * 表示対象から消えたパスを選択から落とす。
 * 再読込・隠しファイル切替の後に呼び、存在しないファイルが選択に残らないようにする。
 */
export function pruneSelection(selected, paths) {
  const visible = new Set(paths);
  const next = new Set();
  for (const p of selected) if (visible.has(p)) next.add(p);
  return next;
}

/**
 * 操作（コピー/移動/削除）の対象を決める。
 *
 * 選択が1件以上あればそれを対象にし、無ければカーソル位置の1件を対象にする。
 * これにより、複数選択を導入しても「何も選択せずに F5」という既存のキーボード
 * 操作の挙動が変わらない。
 *
 * @param {object[]} entries 表示順のエントリ
 * @param {Set<string>} selected 選択されたパス
 * @param {number} cursor カーソル位置
 * @returns {object[]} 対象エントリ（表示順を保つ）
 */
export function targetEntries(entries, selected, cursor) {
  if (selected && selected.size > 0) {
    const picked = entries.filter((e) => selected.has(e.path));
    if (picked.length > 0) return picked;
  }
  const cur = entries[cursor];
  return cur ? [cur] : [];
}

/**
 * 操作対象の説明文。確認ダイアログやトーストで使う。
 * 1件ならファイル名、複数なら件数を出す。
 */
export function describeTargets(targets) {
  if (!targets || targets.length === 0) return '';
  if (targets.length === 1) return targets[0].name;
  return `${targets.length} 件`;
}
