// osdnd.js — OS とのドラッグ＆ドロップの判定ロジック（純粋関数）
//
// 二つの向きを扱う（docs/DRAG-AND-DROP.md §10）。
//   - 外 → Tana: エクスプローラー等からのドロップ。Tauri の onDragDropEvent が
//     座標と実パスを渡してくるので、座標は内部D&Dと同じ resolveDropTarget に流す。
//   - Tana → 外: 内部D&Dのカーソルがウィンドウの外へ出たら、OS のドラッグに渡す。
//
// DOM/Tauri の配線は core/osdragdrop.js。ここは判定だけを持つ。

/**
 * onDragDropEvent の座標（物理ピクセル）を、DOM の座標（CSS ピクセル）に直す。
 * 高DPI（表示倍率 150% 等）では割らないとドロップ先がずれる。
 */
export function toClientPoint(position, scale) {
  if (!position) return null;
  const s = scale > 0 ? scale : 1;
  return { x: position.x / s, y: position.y / s };
}

/** 座標がウィンドウ（表示領域）の外か。境界ちょうどは外とみなす（右端・下端は幅の外） */
export function isOutsideViewport(pt, width, height) {
  if (!pt) return false;
  return pt.x < 0 || pt.y < 0 || pt.x >= width || pt.y >= height;
}

/** 座標がウィンドウの縁（margin 以内）か外か。mouseout の誤検知よけに使う */
export function isNearEdge(pt, width, height, margin = 2) {
  if (!pt) return false;
  return pt.x <= margin || pt.y <= margin || pt.x >= width - margin || pt.y >= height - margin;
}

/**
 * path_kinds の結果をドラッグ対象（エントリ）に直す。消えていたものは外す。
 * @param {{path: string, name: string, is_dir: boolean, exists: boolean}[]} kinds
 */
export function sourcesFromKinds(kinds) {
  if (!Array.isArray(kinds)) return [];
  return kinds
    .filter((k) => k && k.exists && k.path)
    .map((k) => ({ path: k.path, name: k.name || k.path, is_dir: !!k.is_dir }));
}

/**
 * Tana → 外 のドラッグで、OS に渡すものを決める。
 *
 * OS に渡せるのは手元のパスだけ。リモートのファイルは手元の一時フォルダへ
 * 取り寄せてから渡す。リモートのフォルダは丸ごと取り寄せると重く、途中で
 * ボタンを離されると無駄になるので出さない。
 *
 * @param {object[]} sources ドラッグ対象
 * @param {(path: string) => boolean} isRemote
 * @returns {{ok: true, items: {path: string, remote: boolean}[]} | {ok: false, reason: string}}
 */
export function planDragOut(sources, isRemote) {
  if (!Array.isArray(sources) || sources.length === 0) return { ok: false, reason: 'empty' };
  const items = [];
  for (const s of sources) {
    if (!s || !s.path) return { ok: false, reason: 'empty' };
    const remote = !!(isRemote && isRemote(s.path));
    if (remote && s.is_dir) return { ok: false, reason: 'remote-dir' };
    items.push({ path: s.path, remote });
  }
  return { ok: true, items };
}

/** planDragOut が断った理由を、人が読む文言にする */
export function describeDragOutRefusal(reason) {
  if (reason === 'remote-dir') {
    return 'リモートのフォルダは外へドラッグできません（ファイルなら出せます）';
  }
  return '';
}

/**
 * 外からのドロップが、直前に Tana から外へ出したものと同じか。
 *
 * 外へ出したあとで Tana へ戻して落とすと、OS のドロップとして届く。そのとき
 * リモートのファイルは一時フォルダのパスになっているので、元の場所（リモート）に
 * 読み替える。同じ集合のときだけ元の対象を返す。
 *
 * @param {{paths: string[], sources: object[]}|null} outbound
 * @param {string[]} paths
 * @returns {object[]|null}
 */
export function matchOutbound(outbound, paths) {
  if (!outbound || !Array.isArray(paths) || paths.length === 0) return null;
  if (outbound.paths.length !== paths.length) return null;
  const set = new Set(outbound.paths);
  return paths.every((p) => set.has(p)) ? outbound.sources : null;
}

/** ドラッグ画像を描けないとき（canvas が無い等）の 1×1 透明 PNG */
export const FALLBACK_DRAG_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** OS のドラッグ画像に出す文字（「a.txt」 / 3 件） */
export function dragOutLabel(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  return sources.length === 1 ? sources[0].name || '' : `${sources.length} 件`;
}
