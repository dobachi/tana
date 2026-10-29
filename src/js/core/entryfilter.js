// entryfilter.js — 一覧の簡易絞り込み（フォルダだけ / ファイルだけ / 拡張子指定）。純粋・DOM 非依存。
//
// ペインごとに 1 つ持ち、フォルダを移動しても掛けたまま（帯で「絞り込み中」を出し、× で外す）。
// 拡張子の指定はファイルに効き、フォルダは移動できるよう残す（「ファイルだけ」と併用すれば消える）。

/** 何も絞り込まない状態。 */
export const NO_FILTER = Object.freeze({ type: 'all', exts: Object.freeze([]) });

const TYPES = ['all', 'dirs', 'files'];

/** 拡張子 1 つを比較用に整える（".MD" / "*.md" / "md" → "md"）。使えなければ ''。 */
function normExt(s) {
  return String(s == null ? '' : s)
    .trim()
    .replace(/^\*?\.+/, '')
    .toLowerCase();
}

/**
 * 入力欄の文字列を拡張子の配列にする。区切りは空白・カンマ・読点・セミコロン。
 * 例: "md, .txt  *.PDF" → ["md", "txt", "pdf"]（重複は除く）
 */
export function parseExtList(text) {
  const out = [];
  for (const part of String(text == null ? '' : text).split(/[\s,、;；]+/)) {
    const e = normExt(part);
    if (e && !e.includes('/') && !e.includes('\\') && !out.includes(e)) out.push(e);
  }
  return out;
}

/** 壊れた値・未知の種類を正規化する。dirs のときは拡張子を持たない。 */
export function normalizeFilter(f) {
  const o = f || {};
  const type = TYPES.includes(o.type) ? o.type : 'all';
  const exts = type === 'dirs' ? [] : parseExtList((Array.isArray(o.exts) ? o.exts : []).join(' '));
  return { type, exts };
}

/** 何か絞り込んでいるか。 */
export function isFilterActive(f) {
  const n = normalizeFilter(f);
  return n.type !== 'all' || n.exts.length > 0;
}

/** entry の名前が拡張子のどれかで終わるか（"tar.gz" のような複数ドットも可）。 */
function hasExt(name, exts) {
  const lower = String(name || '').toLowerCase();
  return exts.some((e) => lower.length > e.length + 1 && lower.endsWith('.' + e));
}

/** 絞り込みを掛けた一覧を返す（元の配列は変えない）。 */
export function applyEntryFilter(entries, f) {
  const { type, exts } = normalizeFilter(f);
  if (type === 'all' && !exts.length) return entries;
  return entries.filter((e) => {
    if (e.is_dir) return type !== 'files';
    if (type === 'dirs') return false;
    return !exts.length || hasExt(e.name, exts);
  });
}

/** 帯・メニューに出す説明（例: "フォルダだけ" / ".md .txt のファイル"）。絞り込み無しは ''。 */
export function describeFilter(f) {
  const { type, exts } = normalizeFilter(f);
  const extText = exts.map((e) => '.' + e).join(' ');
  if (type === 'dirs') return 'フォルダだけ';
  if (type === 'files') return exts.length ? `${extText} のファイルだけ` : 'ファイルだけ';
  return exts.length ? `${extText} のファイル（とフォルダ）` : '';
}

/** ファイル名の拡張子（最後のドット以降、小文字）。無い・隠しファイル名だけなら ''。 */
export function extOf(name) {
  const n = String(name || '');
  const dot = n.lastIndexOf('.');
  return dot > 0 && dot < n.length - 1 ? n.slice(dot + 1).toLowerCase() : '';
}
