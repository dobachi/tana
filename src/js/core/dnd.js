// dnd.js — ドラッグ＆ドロップの判定ロジック (FR-02, FR-11)
//
// 「何を掴んだか」「どこへ落とすか」「その操作を許すか」だけを扱う純粋関数。
// DOM にも Tauri にも依存しないので単体テストできる。実際のドラッグ操作の追跡は
// core/dragdrop.js、ファイル操作そのものは core/fileops.js が担当する。
//
// 設計の詳細は docs/DRAG-AND-DROP.md。

import { normalizeSeparators } from './pathnav.js';

/**
 * 親ディレクトリを返す。根より上には登らない。
 * "/a/b" → "/a" / "/a" → "/" / "C:/a" → "C:/"
 */
export function parentDirOf(path) {
  const p = normalizeSeparators(path || '');
  if (!p) return '';
  const drive = p.match(/^[A-Za-z]:\//);
  const root = drive ? drive[0] : p.startsWith('/') ? '/' : '';
  if (p === root) return root;
  const idx = p.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return '/';
  const parent = p.slice(0, idx);
  // "C:/a" の親は "C:" ではなく "C:/"
  if (drive && parent.length === 2) return root;
  return parent;
}

/**
 * path が ancestor 自身か、その配下かを判定する。
 *
 * 単純な前方一致で書くと "/foo" が "/foobar" の祖先だと誤判定する。
 * 区切りまで含めて比較すること。
 */
export function isSameOrDescendant(ancestor, path) {
  const a = normalizeSeparators(ancestor || '');
  const p = normalizeSeparators(path || '');
  if (!a || !p) return false;
  if (a === p) return true;
  const prefix = a.endsWith('/') ? a : a + '/';
  return p.startsWith(prefix);
}

/**
 * ドラッグ対象を確定する。
 *
 * 掴んだ行が選択に含まれていれば選択全体を、含まれていなければその1件だけを
 * 対象にする。一般的なファイラの慣習であり、選択済みの複数件を掴んだつもりが
 * 1件だけ動く、という事故を防ぐ。
 *
 * @param {object[]} entries 表示順のエントリ
 * @param {Set<string>} selected 選択されたパス
 * @param {string} draggedPath 掴んだ行のパス
 * @returns {object[]} ドラッグ対象（表示順を保つ）
 */
export function dragPayload(entries, selected, draggedPath) {
  if (!Array.isArray(entries) || !draggedPath) return [];
  const dragged = entries.find((e) => e && e.path === draggedPath);
  if (!dragged) return [];
  if (selected && typeof selected.has === 'function' && selected.has(draggedPath)) {
    const picked = entries.filter((e) => selected.has(e.path));
    if (picked.length > 0) return picked;
  }
  return [dragged];
}

/**
 * ドロップしたときの効果を決める。
 *
 * 既定はコピー（非破壊）、Shift 押下中は移動。「同一ボリュームなら移動」という
 * OS の慣習は採らない。Tana はローカル/OneDrive/WSL を跨ぐ用途が主で、判定を
 * 誤ると元ファイルを失うため（docs/DRAG-AND-DROP.md §4）。
 *
 * @param {{shift?: boolean}} mods 修飾キーの状態
 * @param {boolean} canMutate 破壊的操作が許可されているか（safemode.canMutate）
 * @returns {'copy'|'move'|'none'}
 */
export function dropEffect(mods, canMutate) {
  if (!canMutate) return 'none';
  return mods && mods.shift ? 'move' : 'copy';
}

function deny(reason) {
  return { ok: false, reason };
}

/**
 * そのドロップを実行してよいか判定する。
 *
 * ここを漏らすとデータが壊れる。特に into-descendant（自分の子孫へのドロップ）は
 * コピーが無限再帰してディスクを埋める。
 *
 * @param {object[]} sources ドラッグ対象
 * @param {string} destDir 宛先ディレクトリ
 * @param {'copy'|'move'|'none'} effect
 * @returns {{ok: boolean, reason: string|null}}
 */
export function validateDrop(sources, destDir, effect) {
  if (!Array.isArray(sources) || sources.length === 0 || !destDir) return deny('empty');
  if (effect !== 'copy' && effect !== 'move') return deny('denied');

  const dest = normalizeSeparators(destDir);
  for (const s of sources) {
    if (!s || !s.path) return deny('empty');
    const p = normalizeSeparators(s.path);
    if (p === dest) return deny('into-self');
    if (s.is_dir && isSameOrDescendant(p, dest)) return deny('into-descendant');
  }

  // 移動で全件が既に宛先にあるなら何も起きない。無駄な衝突ダイアログを出さない。
  // コピーは「同じフォルダ内に複製を作る」が正当な操作なので弾かない。
  if (effect === 'move' && sources.every((s) => parentDirOf(s.path) === dest)) {
    return deny('same-dir');
  }

  return { ok: true, reason: null };
}

/**
 * ドラッグ開始のしきい値を超えたか。
 *
 * これが無いと、ただのクリック（選択）が毎回ドラッグ扱いになって操作できなくなる。
 */
export function exceededThreshold(start, current, px = 5) {
  if (!start || !current) return false;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.hypot(dx, dy) >= px;
}

/**
 * ドラッグゴーストの表示文字列。
 *
 * 自作D&Dでは OS のカーソルにコピー/移動を出せないので、効果を文字で示すのが
 * ユーザーに伝える唯一の手段になる（docs/DRAG-AND-DROP.md §5）。
 */
export function describeDrag(sources, effect) {
  if (!sources || sources.length === 0) return '';
  // 1件はファイル名を鉤括弧で囲む。「a.txtをコピー」だと名前の切れ目が読み取れず、
  // 名前に「を」を含むファイルで特に紛らわしくなるため。
  const what = sources.length === 1 ? `「${sources[0].name}」` : `${sources.length} 件`;
  if (effect === 'move') return `${what}を移動`;
  if (effect === 'copy') return `${what}をコピー`;
  return what;
}
