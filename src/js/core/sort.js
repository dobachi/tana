// sort.js — エントリの並べ替え（純粋関数）。DOM/Tauri 非依存でテスト可能。
//
// ベストプラクティス（DETAIL-VIEW-SORT.md）:
// - 名前は自然順（file2 < file10）。Intl.Collator の numeric:true を使う
// - フォルダ先頭（既定）。方向に関わらずフォルダを上に固める
// - 安定ソート + 同値時は名前で tie-break

export const SORT_KEYS = Object.freeze(['name', 'size', 'modified', 'ext']);
export const SORT_LABELS = Object.freeze({
  name: '名前',
  size: 'サイズ',
  modified: '更新日時',
  ext: '拡張子',
});
export const DEFAULT_SORT = Object.freeze({ key: 'name', dir: 'asc', foldersFirst: true });

/** ファイル名の拡張子（小文字・ドット無し）。無ければ ''。 */
export function extOf(name) {
  const base = String(name || '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** 既定の自然順コレータ。テストでは固定ロケールを注入できる。 */
export function defaultCollator() {
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
}

function compareByKey(key, a, b, collator) {
  switch (key) {
    case 'size':
      return (a.size || 0) - (b.size || 0);
    case 'modified':
      return (a.modified || 0) - (b.modified || 0);
    case 'ext':
      return collator.compare(extOf(a.name), extOf(b.name));
    case 'name':
    default:
      return collator.compare(a.name || '', b.name || '');
  }
}

/**
 * エントリ配列を並べ替えた新しい配列を返す（元配列は不変）。
 * @param {Array<object>} entries
 * @param {{key?:string, dir?:'asc'|'desc', foldersFirst?:boolean}} sort
 * @param {Intl.Collator} [collator]
 */
export function sortEntries(entries, sort = {}, collator = defaultCollator()) {
  const key = SORT_KEYS.includes(sort.key) ? sort.key : 'name';
  const dir = sort.dir === 'desc' ? 'desc' : 'asc';
  const foldersFirst = sort.foldersFirst !== false;
  const mul = dir === 'desc' ? -1 : 1;

  return entries.slice().sort((a, b) => {
    // フォルダ先頭は方向に関わらず固定
    if (foldersFirst && !!a.is_dir !== !!b.is_dir) return a.is_dir ? -1 : 1;
    let r = compareByKey(key, a, b, collator);
    if (r === 0 && key !== 'name') r = collator.compare(a.name || '', b.name || ''); // tie-break
    return mul * r;
  });
}

/**
 * 列ヘッダクリック/キー操作での次のソート状態。同じキーなら方向トグル、
 * 別キーなら昇順にリセット。
 * @param {{key:string, dir:string, foldersFirst?:boolean}} current
 * @param {string} key
 */
export function nextSort(current, key) {
  const cur = current || DEFAULT_SORT;
  const k = SORT_KEYS.includes(key) ? key : cur.key;
  if (cur.key === k) {
    return { ...cur, key: k, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { ...cur, key: k, dir: 'asc' };
}
