import { describe, it, expect, vi } from 'vitest';
import {
  contextTargetOf,
  locationItems,
  buildPlaceMenu,
  buildCrumbMenu,
  buildHeaderMenu,
  buildTabMenu,
  buildTabStripMenu,
  buildColumnsMenu,
  buildFavBookmarkMenu,
  buildFavFolderMenu,
  buildFavGroupMenu,
  buildTagMenu,
  buildFavBlankMenu,
  buildSearchHitMenu,
  buildPreviewMenu,
} from '../core/contextmenus.js';

const labels = (items) => items.filter((i) => !i.separator).map((i) => i.label);
const byLabel = (items, l) => items.find((i) => i.label === l);

function dom(html) {
  document.body.innerHTML = html;
  return (sel) => document.querySelector(sel);
}

describe('contextTargetOf（どの部品の上か）', () => {
  const $ = dom(`
    <aside id="sidebar">
      <ul id="places"><li><div class="place-row" data-path="/home/me"><span class="n">ホーム</span></div></li></ul>
      <section id="favorites-section">
        <input id="fav-search" />
        <div id="fav-tags"><button class="fav-tag" data-tag="work">#work</button></div>
        <ul id="favorites">
          <li><div class="fav-row" data-id="fav-1"><span class="fav-name">a</span></div></li>
          <li><div class="fav-row fav-group-row" data-key="host:k16"><span>k16</span></div></li>
        </ul>
        <div class="fav-empty-space"></div>
      </section>
    </aside>
    <section class="pane" data-pane="right">
      <div class="pane-tabs"><div class="pane-tab" data-index="2"><span class="lbl">x</span></div><button class="pane-tab-add">+</button></div>
      <header class="pane-header"><span class="pane-path"><button class="crumb" data-path="/srv">srv</button></span><input class="pane-path-input" /></header>
      <div class="pane-filter"><span>絞り込み</span></div>
      <div class="pane-columns"><button class="pane-col">名前</button></div>
      <ul class="pane-list"></ul>
    </section>
    <section id="preview"><div id="preview-content"><p class="t">text</p></div></section>
    <ul class="search-list"><li><div class="search-row" data-path="/srv/a.md"><span class="m">a</span></div></li></ul>
    <footer id="statusbar"><span class="s">x</span></footer>
    <textarea id="ta"></textarea>
  `);

  it.each([
    ['.lbl', { kind: 'tab', pane: 'right', index: 2 }],
    ['.pane-tab-add', { kind: 'tabstrip', pane: 'right' }],
    ['.crumb', { kind: 'crumb', pane: 'right', path: '/srv' }],
    ['.pane-path', { kind: 'header', pane: 'right' }],
    ['.pane-col', { kind: 'columns', pane: 'right' }],
    ['.pane-filter span', { kind: 'columns', pane: 'right' }],
    ['.place-row .n', { kind: 'place', path: '/home/me' }],
    ['#favorites .fav-name', { kind: 'fav', id: 'fav-1' }],
    ['.fav-group-row span', { kind: 'favgroup', key: 'host:k16' }],
    ['.fav-tag', { kind: 'tag', tag: 'work' }],
    ['.fav-empty-space', { kind: 'favblank' }],
    ['.search-row .m', { kind: 'searchhit', path: '/srv/a.md' }],
    ['#preview .t', { kind: 'preview' }],
    ['#statusbar .s', { kind: 'none' }],
  ])('%s', (sel, want) => {
    expect(contextTargetOf($(sel))).toEqual(want);
  });

  it('文字入力欄は既定のメニュー（コピー・貼り付け）を残す', () => {
    expect(contextTargetOf($('#fav-search')).kind).toBe('native');
    expect(contextTargetOf($('.pane-path-input')).kind).toBe('native');
    expect(contextTargetOf($('#ta')).kind).toBe('native');
  });

  it('文字ノード・null でも落ちない', () => {
    expect(contextTargetOf($('.crumb').firstChild).kind).toBe('crumb');
    expect(contextTargetOf(null)).toEqual({ kind: 'none' });
  });
});

function actions() {
  const names = [
    'open',
    'openOther',
    'openNewTab',
    'openNewWindow',
    'copyPath',
    'addFavorite',
    'pathInput',
    'parent',
    'addCurrent',
    'close',
    'closeOthers',
    'closeRight',
    'duplicate',
    'moveLeft',
    'moveRight',
    'newTab',
    'sortBy',
    'reverse',
    'rename',
    'editTags',
    'moveUp',
    'moveDown',
    'moveToFolder',
    'outdent',
    'remove',
    'toggle',
    'addFolderInside',
    'collapseAll',
    'expandAll',
    'ungroup',
    'filterTag',
    'clearTag',
    'groupByTag',
    'addFolder',
    'copySelection',
    'openApp',
    'closePreview',
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn()]));
}

describe('場所の共通項目', () => {
  it('反対のペイン・新しいタブ・新しいウィンドウ・コピー・お気に入り、をその場所に効かせる', () => {
    const a = actions();
    const items = locationItems('/srv', a);
    expect(labels(items)).toEqual([
      '反対のペインで開く',
      '新しいタブで開く',
      '新しいウィンドウで開く',
      'パスをコピー',
      'お気に入りに追加…',
    ]);
    for (const it of items.filter((i) => i.action)) it.action();
    expect(a.openOther).toHaveBeenCalledWith('/srv');
    expect(a.openNewTab).toHaveBeenCalledWith('/srv');
    expect(a.openNewWindow).toHaveBeenCalledWith('/srv');
    expect(a.copyPath).toHaveBeenCalledWith('/srv');
    expect(a.addFavorite).toHaveBeenCalledWith('/srv');
  });

  it('ファイルマネージャ表示は渡されたときだけ足す', () => {
    const a = { ...actions(), reveal: (p) => [{ label: `表示 ${p}`, action: vi.fn() }] };
    expect(labels(locationItems('/x', a))).toContain('表示 /x');
  });

  it('場所・パンくずは先頭で「開く / ここへ移動」', () => {
    const a = actions();
    buildPlaceMenu('/h', a)[0].action();
    expect(a.open).toHaveBeenCalledWith('/h');
    expect(buildCrumbMenu('/s', a)[0].label).toBe('ここへ移動');
  });
});

describe('ペイン見出し', () => {
  it('パス入力・親へ・現在地の操作。場所が無ければ現在地の項目は無効', () => {
    const items = buildHeaderMenu(null, actions());
    expect(byLabel(items, 'パスを入力して移動…').shortcut).toBe('Ctrl+L');
    expect(byLabel(items, '現在地のパスをコピー').disabled).toBe(true);
    expect(byLabel(buildHeaderMenu('/d', actions()), '現在地のパスをコピー').disabled).toBe(false);
  });
});

describe('タブ', () => {
  it('1 枚だけなら閉じる系は無効、端では左右の移動が無効', () => {
    const one = buildTabMenu({ index: 0, count: 1, dir: '/a' }, actions());
    expect(byLabel(one, '閉じる').disabled).toBe(true);
    expect(byLabel(one, '他のタブを閉じる').disabled).toBe(true);
    expect(byLabel(one, '右側のタブを閉じる').disabled).toBe(true);
    expect(byLabel(one, 'タブを左へ移動').disabled).toBe(true);
    expect(byLabel(one, 'タブを右へ移動').disabled).toBe(true);
    const mid = buildTabMenu({ index: 1, count: 3, dir: '/b' }, actions());
    for (const l of [
      '閉じる',
      '他のタブを閉じる',
      '右側のタブを閉じる',
      'タブを左へ移動',
      'タブを右へ移動',
    ]) {
      expect(byLabel(mid, l).disabled).toBe(false);
    }
  });

  it('右クリックしたタブ（アクティブとは限らない）に効く', () => {
    const a = actions();
    const items = buildTabMenu({ index: 2, count: 4, dir: '/c' }, a);
    byLabel(items, '閉じる').action();
    byLabel(items, 'タブを複製').action();
    byLabel(items, '新しいウィンドウで開く').action();
    expect(a.close).toHaveBeenCalledWith(2);
    expect(a.duplicate).toHaveBeenCalledWith(2);
    expect(a.openNewWindow).toHaveBeenCalledWith('/c');
    // タブの上で「新しいタブで開く」は複製と同じなので出さない
    expect(labels(items)).not.toContain('新しいタブで開く');
  });

  it('タブ帯の空き所は新しいタブ', () => {
    expect(buildTabStripMenu(actions())[0]).toMatchObject({
      label: '新しいタブ',
      shortcut: 'Ctrl+T',
    });
  });
});

describe('列見出し', () => {
  it('今の並び順に ▲▼、各キーと反転、後ろに絞り込みの項目', () => {
    const a = actions();
    const items = buildColumnsMenu(
      { key: 'size', dir: 'desc' },
      [
        ['name', '名前'],
        ['size', 'サイズ'],
        ['ext', '拡張子'],
      ],
      [{ label: 'フォルダだけ', action: vi.fn() }],
      a,
    );
    expect(labels(items)).toEqual([
      '　名前で並べる',
      '▼ サイズで並べる',
      '　拡張子で並べる',
      '　並び順を反転',
      'フォルダだけ',
    ]);
    expect(items[2].shortcut).toBe('s → e');
    items[0].action();
    expect(a.sortBy).toHaveBeenCalledWith('name');
  });
});

describe('お気に入り', () => {
  it('ブックマーク: 開く系・名前・タグ・並べ替え・削除（マウスだけで全部できる）', () => {
    const a = actions();
    const items = buildFavBookmarkMenu(
      { path: '/w', reorder: true, inFolder: true, hasFolders: true },
      a,
    );
    expect(labels(items)).toEqual([
      '開く',
      '反対のペインで開く',
      '新しいタブで開く',
      '新しいウィンドウで開く',
      'パスをコピー',
      '名前を変更…',
      'タグを編集…',
      '上へ',
      '下へ',
      'フォルダへ移動…',
      'フォルダから出す',
      'お気に入りから削除',
    ]);
    expect(byLabel(items, 'お気に入りから削除').danger).toBe(true);
    byLabel(items, 'タグを編集…').action();
    expect(a.editTags).toHaveBeenCalled();
  });

  it('並べ替えできない・フォルダに入っていない・フォルダが無いときは無効', () => {
    const items = buildFavBookmarkMenu({ path: '/w' }, actions());
    expect(byLabel(items, '上へ').disabled).toBe(true);
    expect(byLabel(items, '下へ').disabled).toBe(true);
    expect(byLabel(items, 'フォルダへ移動…').disabled).toBe(true);
    expect(byLabel(items, 'フォルダから出す').disabled).toBe(true);
  });

  it('フォルダ: 開閉・中にフォルダ作成・名前・並べ替え・削除（中身の件数を示す）', () => {
    const items = buildFavFolderMenu({ open: true, childCount: 3 }, actions());
    expect(items[0]).toMatchObject({ label: '閉じる', shortcut: 'h' });
    expect(labels(items)).toContain('この中にフォルダを作成…');
    expect(labels(items)).toContain('フォルダを削除（中の 3 件ごと）…');
    expect(labels(buildFavFolderMenu({ open: false }, actions()))).toContain('フォルダを削除');
  });

  it('まとめ見出し・タグ・空き所', () => {
    expect(labels(buildFavGroupMenu({ collapsed: true }, actions()))[0]).toBe('開く');
    const a = actions();
    buildTagMenu({ tag: 'work' }, a)[0].action();
    expect(a.filterTag).toHaveBeenCalledWith('work');
    expect(buildTagMenu({ tag: 'work', active: true }, a)[0].label).toBe('#work の絞り込みを解除');
    const blank = buildFavBlankMenu([{ label: '✓ 名前順' }], actions());
    expect(labels(blank)).toEqual(['現在地をお気に入りに追加…', 'フォルダを作成…', '✓ 名前順']);
  });
});

describe('検索結果・プレビュー', () => {
  it('検索結果: その場所を開く・パスをコピー', () => {
    const a = actions();
    const items = buildSearchHitMenu('/s/a.md', a);
    items[0].action();
    expect(a.open).toHaveBeenCalledWith('/s/a.md');
    expect(labels(items)).toEqual(['その場所を開く', 'パスをコピー']);
  });

  it('プレビュー: 選択があればコピーを先頭に、ファイルがあれば開く・コピー、最後に閉じる', () => {
    expect(labels(buildPreviewMenu({ hasSelection: true, path: '/a.md' }, actions()))).toEqual([
      'コピー',
      '既定のアプリで開く',
      'パスをコピー',
      'プレビューを閉じる',
    ]);
    expect(labels(buildPreviewMenu({}, actions()))).toEqual(['プレビューを閉じる']);
  });
});
