// contextmenus.js — 右クリックメニュー（ファイル一覧以外の部品）。純粋ロジック。
//
// 画面全体の contextmenu を app.js が 1 か所で受け、contextTargetOf で「どの部品の上か」を
// 見分けて、ここの build* で項目を組み立てる。ブラウザ既定のメニュー（再読み込み・検証 等）は
// 出さない。文字入力欄だけはコピー・貼り付けのために既定のメニューを残す。
// ファイル一覧（行・空き所）は filepane が自前で受ける（ここより先に処理される）。
//
// 項目は menu.js の showMenu が解釈する { label, shortcut?, action, disabled?, danger? } /
// { separator: true }。実行は app.js が actions として注入する（appmenus.js と同じ方式）。

const SEP = { separator: true };

/** 右クリックされた要素から、どの部品の上かを見分ける。 */
export function contextTargetOf(el) {
  const t = el && typeof el.closest === 'function' ? el : el && el.parentElement;
  if (!t || typeof t.closest !== 'function') return { kind: 'none' };
  // 文字入力欄はコピー・貼り付けのため既定のメニューを残す
  if (t.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) {
    return { kind: 'native' };
  }
  const paneEl = t.closest('[data-pane]');
  const pane = paneEl ? paneEl.dataset.pane : null;
  let m;
  if ((m = t.closest('.pane-tab'))) {
    return { kind: 'tab', pane, index: Number(m.dataset.index) };
  }
  if (t.closest('.pane-tabs')) return { kind: 'tabstrip', pane };
  if ((m = t.closest('.crumb'))) return { kind: 'crumb', pane, path: m.dataset.path || m.title };
  if (t.closest('.pane-header')) return { kind: 'header', pane };
  if (t.closest('.pane-columns, .pane-filter')) return { kind: 'columns', pane };
  if ((m = t.closest('.place-row'))) return { kind: 'place', path: m.dataset.path || m.title };
  if ((m = t.closest('.fav-group-row'))) return { kind: 'favgroup', key: m.dataset.key };
  if ((m = t.closest('#favorites .fav-row'))) return { kind: 'fav', id: m.dataset.id };
  if ((m = t.closest('[data-tag]'))) return { kind: 'tag', tag: m.dataset.tag };
  if (t.closest('#favorites-section')) return { kind: 'favblank' };
  if ((m = t.closest('.search-row'))) return { kind: 'searchhit', path: m.dataset.path };
  if (t.closest('#preview')) return { kind: 'preview' };
  return { kind: 'none' };
}

/**
 * 場所（フォルダ）に共通の項目: 反対のペイン・新しいタブ・新しいウィンドウで開く、
 * パスをコピー、お気に入りに追加。a.reveal(path) はファイルマネージャ表示の項目配列を返す。
 */
export function locationItems(path, a = {}, opts = {}) {
  const items = [
    { label: '反対のペインで開く', action: () => a.openOther(path) },
    { label: '新しいタブで開く', action: () => a.openNewTab(path) },
    { label: '新しいウィンドウで開く', action: () => a.openNewWindow(path) },
    SEP,
    { label: 'パスをコピー', action: () => a.copyPath(path) },
  ];
  if (opts.favorite !== false) {
    items.push({ label: 'お気に入りに追加…', action: () => a.addFavorite(path) });
  }
  if (typeof a.reveal === 'function') items.push(...a.reveal(path));
  return items;
}

/** 「場所」サイドバーの 1 行 */
export function buildPlaceMenu(path, a = {}) {
  return [
    { label: '開く', shortcut: 'Enter', action: () => a.open(path) },
    ...locationItems(path, a),
  ];
}

/** パンくずの 1 段（その階層のフォルダ） */
export function buildCrumbMenu(path, a = {}) {
  return [{ label: 'ここへ移動', action: () => a.open(path) }, ...locationItems(path, a)];
}

/** ペイン見出しの空き所 */
export function buildHeaderMenu(dir, a = {}) {
  return [
    { label: 'パスを入力して移動…', shortcut: 'Ctrl+L', action: a.pathInput },
    { label: '親フォルダへ', shortcut: 'h', action: a.parent },
    SEP,
    {
      label: '現在地のパスをコピー',
      shortcut: 'y → d',
      disabled: !dir,
      action: () => a.copyPath(dir),
    },
    { label: 'ここをお気に入りに追加…', shortcut: 'Ctrl+D', disabled: !dir, action: a.addCurrent },
    { label: 'ここを新しいウィンドウで開く', disabled: !dir, action: () => a.openNewWindow(dir) },
  ];
}

/**
 * タブ 1 枚。index はそのタブ、count は枚数。
 * @param {{index: number, count: number, dir: string}} s
 */
export function buildTabMenu(s, a = {}) {
  const { index = 0, count = 1, dir = '' } = s || {};
  const single = count <= 1;
  return [
    { label: '閉じる', shortcut: 'Ctrl+W', disabled: single, action: () => a.close(index) },
    { label: '他のタブを閉じる', disabled: single, action: () => a.closeOthers(index) },
    {
      label: '右側のタブを閉じる',
      disabled: index >= count - 1,
      action: () => a.closeRight(index),
    },
    SEP,
    { label: 'タブを複製', action: () => a.duplicate(index) },
    {
      label: 'タブを左へ移動',
      shortcut: 't → h',
      disabled: index <= 0,
      action: () => a.moveLeft(index),
    },
    {
      label: 'タブを右へ移動',
      shortcut: 't → l',
      disabled: index >= count - 1,
      action: () => a.moveRight(index),
    },
    SEP,
    ...locationItems(dir, a).filter((it) => it.label !== '新しいタブで開く'),
  ];
}

/** タブ帯の空き所 */
export function buildTabStripMenu(a = {}) {
  return [{ label: '新しいタブ', shortcut: 'Ctrl+T', action: a.newTab }];
}

/**
 * 列見出し・絞り込みの帯: 並び替えと絞り込み。
 * @param {{key: string, dir: string}} sort 今の並び順
 * @param {Array<object>} filterItems appmenus.buildFilterMenuItems の結果
 * @param {Array<[string, string]>} keys [[key, ラベル], …]
 */
export function buildColumnsMenu(sort, keys, filterItems, a = {}) {
  const { key = 'name', dir = 'asc' } = sort || {};
  return [
    ...keys.map(([k, label]) => ({
      label: `${key === k ? (dir === 'asc' ? '▲ ' : '▼ ') : '　'}${label}で並べる`,
      shortcut: k === 'ext' ? 's → e' : `s → ${k[0]}`,
      action: () => a.sortBy(k),
    })),
    { label: '　並び順を反転', shortcut: 's → r', action: a.reverse },
    SEP,
    ...filterItems,
  ];
}

/**
 * お気に入りのブックマーク。
 * @param {{path: string, reorder: boolean, inFolder: boolean, hasFolders: boolean}} s
 *   reorder: 手動の並びで絞り込み中でない（上へ・下へが効く）
 */
export function buildFavBookmarkMenu(s, a = {}) {
  const { path = '', reorder = false, inFolder = false, hasFolders = false } = s || {};
  return [
    { label: '開く', shortcut: 'Enter', action: () => a.open(path) },
    ...locationItems(path, a, { favorite: false }),
    SEP,
    { label: '名前を変更…', action: a.rename },
    { label: 'タグを編集…', shortcut: 't', action: a.editTags },
    ...reorderItems({ reorder, inFolder, hasFolders }, a),
    SEP,
    { label: 'お気に入りから削除', danger: true, action: a.remove },
  ];
}

/**
 * お気に入りのフォルダ。
 * @param {{open: boolean, reorder: boolean, inFolder: boolean, hasFolders: boolean, childCount: number}} s
 */
export function buildFavFolderMenu(s, a = {}) {
  const {
    open = false,
    reorder = false,
    inFolder = false,
    hasFolders = false,
    childCount = 0,
  } = s || {};
  return [
    { label: open ? '閉じる' : '開く', shortcut: open ? 'h' : 'l', action: a.toggle },
    { label: 'この中にフォルダを作成…', action: a.addFolderInside },
    SEP,
    { label: '名前を変更…', action: a.rename },
    ...reorderItems({ reorder, inFolder, hasFolders }, a),
    SEP,
    {
      label: childCount ? `フォルダを削除（中の ${childCount} 件ごと）…` : 'フォルダを削除',
      danger: true,
      action: a.remove,
    },
  ];
}

/** 並べ替え・フォルダ間の移動（ブックマーク / フォルダ共通） */
function reorderItems({ reorder, inFolder, hasFolders }, a) {
  return [
    SEP,
    { label: '上へ', shortcut: 'Alt+↑', disabled: !reorder, action: a.moveUp },
    { label: '下へ', shortcut: 'Alt+↓', disabled: !reorder, action: a.moveDown },
    { label: 'フォルダへ移動…', disabled: !hasFolders, action: a.moveToFolder },
    { label: 'フォルダから出す', shortcut: 'Alt+←', disabled: !inFolder, action: a.outdent },
  ];
}

/** まとめ方の見出し（接続先・タグ） */
export function buildFavGroupMenu(s, a = {}) {
  const { collapsed = false } = s || {};
  return [
    { label: collapsed ? '開く' : 'たたむ', action: a.toggle },
    { label: 'すべてたたむ', action: a.collapseAll },
    { label: 'すべて開く', action: a.expandAll },
    SEP,
    { label: 'まとめない', action: a.ungroup },
  ];
}

/** タグのチップ */
export function buildTagMenu(s, a = {}) {
  const { tag = '', active = false } = s || {};
  return [
    active
      ? { label: `#${tag} の絞り込みを解除`, action: a.clearTag }
      : { label: `#${tag} で絞り込む`, action: () => a.filterTag(tag) },
    { label: 'タグでまとめる', action: a.groupByTag },
  ];
}

/**
 * お気に入りの空き所: 追加・フォルダ作成と、並べ替え・まとめ方（⇅ と同じ項目）。
 * @param {Array<object>} optionItems favoritesview.optionItems()
 */
export function buildFavBlankMenu(optionItems, a = {}) {
  return [
    { label: '現在地をお気に入りに追加…', shortcut: 'Ctrl+D', action: a.addCurrent },
    { label: 'フォルダを作成…', action: a.addFolder },
    SEP,
    ...optionItems,
  ];
}

/** 検索結果の 1 件 */
export function buildSearchHitMenu(path, a = {}) {
  return [
    { label: 'その場所を開く', shortcut: 'Enter', action: () => a.open(path) },
    { label: 'パスをコピー', action: () => a.copyPath(path) },
  ];
}

/**
 * プレビュー。選択した文字があればコピーを先頭に出す。
 * @param {{hasSelection: boolean, path: string|null}} s path はプレビュー中のファイル
 */
export function buildPreviewMenu(s, a = {}) {
  const { hasSelection = false, path = null } = s || {};
  const items = [];
  if (hasSelection)
    items.push({ label: 'コピー', shortcut: 'Ctrl+C', action: a.copySelection }, SEP);
  if (path) {
    items.push(
      { label: '既定のアプリで開く', shortcut: 'o → o', action: () => a.openApp(path) },
      { label: 'パスをコピー', action: () => a.copyPath(path) },
      SEP,
    );
  }
  items.push({ label: 'プレビューを閉じる', shortcut: 'Ctrl+P', action: a.closePreview });
  return items;
}
