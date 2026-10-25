import { describe, it, expect, vi } from 'vitest';
import {
  createFavorites,
  serialize,
  searchTree,
  defaultBookmarkName,
  bookmarkTitle,
  normalizeTags,
  collectTags,
} from '../core/favorites.js';

describe('favorites モデル', () => {
  it('ブックマーク/フォルダを追加し、ネストできる', () => {
    const f = createFavorites();
    const folderId = f.addFolder('仕事');
    f.addBookmark('提案書', '/work/proposal', folderId);
    f.addBookmark('WSL home', '\\\\wsl$\\Ubuntu\\home');

    const root = f.getRoot();
    expect(root).toHaveLength(2); // 仕事フォルダ + WSL home
    const folder = root.find((n) => n.type === 'folder');
    expect(folder.children).toHaveLength(1);
    expect(folder.children[0].path).toBe('/work/proposal');
  });

  it('path の無いブックマークは追加しない', () => {
    const f = createFavorites();
    expect(f.addBookmark('x', '')).toBeNull();
    expect(f.getRoot()).toHaveLength(0);
  });

  it('remove は配下ごと削除する', () => {
    const f = createFavorites();
    const folderId = f.addFolder('A');
    f.addBookmark('b', '/b', folderId);
    expect(f.remove(folderId)).toBe(true);
    expect(f.getRoot()).toHaveLength(0);
  });

  it('rename / toggleOpen が効く', () => {
    const f = createFavorites();
    const id = f.addFolder('old');
    expect(f.rename(id, 'new')).toBe(true);
    expect(f.find(id).name).toBe('new');
    expect(f.find(id).open).toBe(true);
    expect(f.toggleOpen(id)).toBe(false);
    expect(f.find(id).open).toBe(false);
  });

  it('subscribe は即時通知し、変更で呼ばれる', () => {
    const f = createFavorites();
    const fn = vi.fn();
    f.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    f.addFolder('x');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('toJSON は id を含まず、再構築でラウンドトリップする', () => {
    const f = createFavorites();
    const folderId = f.addFolder('仕事');
    f.addBookmark('提案', '/p', folderId);
    const json = f.toJSON();
    expect(JSON.stringify(json)).not.toContain('"id"');

    const f2 = createFavorites(json);
    expect(f2.getRoot()[0].name).toBe('仕事');
    expect(f2.getRoot()[0].children[0].path).toBe('/p');
  });
});

describe('searchTree (FR-06)', () => {
  const tree = [
    {
      type: 'folder',
      name: '仕事',
      children: [
        { type: 'bookmark', name: '提案書', path: '/work/proposal' },
        { type: 'bookmark', name: 'メモ', path: '/work/notes' },
      ],
    },
    { type: 'bookmark', name: 'ダウンロード', path: '/home/me/Downloads' },
  ];

  it('空クエリは空配列', () => {
    expect(searchTree(tree, '')).toEqual([]);
  });

  it('名前・パスにマッチし、パンくず付きで返す', () => {
    const byName = searchTree(tree, '提案');
    expect(byName).toHaveLength(1);
    expect(byName[0].breadcrumb).toEqual(['仕事']);

    const byPath = searchTree(tree, 'downloads');
    expect(byPath).toHaveLength(1);
    expect(byPath[0].name).toBe('ダウンロード');
    expect(byPath[0].breadcrumb).toEqual([]);
  });

  it('大文字小文字を区別しない', () => {
    expect(searchTree(tree, 'WORK')).toHaveLength(2);
  });
});

describe('serialize', () => {
  it('フォルダ/ブックマークを id 抜きで保持', () => {
    const out = serialize([
      { id: 'x', type: 'folder', name: 'f', open: false, children: [] },
      { id: 'y', type: 'bookmark', name: 'b', path: '/b' },
    ]);
    expect(out).toEqual([
      { type: 'folder', name: 'f', open: false, children: [] },
      { type: 'bookmark', name: 'b', path: '/b' },
    ]);
  });
});

describe('リモートのお気に入り (FR-20)', () => {
  it('既定名は末尾の階層名、リモートは接続先付き', () => {
    expect(defaultBookmarkName('/home/u/docs')).toBe('docs');
    expect(defaultBookmarkName('C:\\Users\\u')).toBe('u');
    expect(defaultBookmarkName('/')).toBe('/');
    expect(defaultBookmarkName('sftp://k16/home/u/notes')).toBe('k16:notes');
    expect(defaultBookmarkName('sftp://me@k16/')).toBe('me@k16:/');
    expect(defaultBookmarkName('sftp://k16')).toBe('k16:~');
  });
  it('ツールチップはリモートなら host:path', () => {
    expect(bookmarkTitle('sftp://k16/a/b')).toBe('k16:/a/b');
    expect(bookmarkTitle('/a/b')).toBe('/a/b');
  });
  it('リモートの場所をブックマークでき、保存・復元しても残る', () => {
    const f = createFavorites([], { now: () => 5 });
    f.addBookmark('k16:notes', 'sftp://k16/home/u/notes');
    const restored = createFavorites(JSON.parse(JSON.stringify(f.toJSON())));
    expect(restored.toJSON()).toEqual([
      { type: 'bookmark', name: 'k16:notes', path: 'sftp://k16/home/u/notes', added: 5 },
    ]);
  });
});

describe('登録日時とタグ', () => {
  it('追加時に登録日時を持ち、保存・復元で残る。古いデータ（日時なし）も読める', () => {
    let t = 100;
    const f = createFavorites([{ type: 'bookmark', name: 'old', path: '/old' }], {
      now: () => t++,
    });
    f.addBookmark('a', '/a');
    f.addFolder('F');
    const json = f.toJSON();
    expect(json[0]).toEqual({ type: 'bookmark', name: 'old', path: '/old' });
    expect(json[1].added).toBe(100);
    expect(json[2].added).toBe(101);
    expect(createFavorites(json).toJSON()).toEqual(json);
  });

  it('normalizeTags: # と空白を落とし、重複（大小無視）と空を除く', () => {
    expect(normalizeTags(' #work  doc,仕事、Work ')).toEqual(['work', 'doc', '仕事']);
    expect(normalizeTags(['#a', '', 'A', null])).toEqual(['a']);
    expect(normalizeTags('')).toEqual([]);
  });

  it('setTags で付け替え、空で外す。フォルダには付けない', () => {
    const f = createFavorites();
    const id = f.addBookmark('a', '/a');
    const folder = f.addFolder('F');
    expect(f.setTags(id, '#x y')).toBe(true);
    expect(f.find(id).tags).toEqual(['x', 'y']);
    expect(f.toJSON()[0].tags).toEqual(['x', 'y']);
    expect(f.setTags(id, '')).toBe(true);
    expect(f.find(id).tags).toBeUndefined();
    expect(f.setTags(folder, 'x')).toBe(false);
  });

  it('collectTags はフォルダの中も含めて名前順・重複なし（綴りは先に出た方）', () => {
    const f = createFavorites();
    const folder = f.addFolder('F');
    f.setTags(f.addBookmark('a', '/a'), 'b a');
    f.setTags(f.addBookmark('c', '/c', folder), 'A c');
    // ツリー順で F の中の 'A' が先に出る
    expect(collectTags(f.getRoot())).toEqual(['A', 'b', 'c']);
    expect(f.tags()).toEqual(['A', 'b', 'c']);
  });
});

describe('手動の並べ替え', () => {
  const names = (list) => list.map((n) => n.name);
  function three() {
    const f = createFavorites();
    const a = f.addBookmark('a', '/a');
    const b = f.addBookmark('b', '/b');
    const F = f.addFolder('F');
    return { f, a, b, F };
  }

  it('move: 前・後ろ・フォルダの中へ', () => {
    const { f, a, b, F } = three();
    expect(f.move(a, b, 'after')).toBe(true);
    expect(names(f.getRoot())).toEqual(['b', 'a', 'F']);
    expect(f.move(F, b, 'before')).toBe(true);
    expect(names(f.getRoot())).toEqual(['F', 'b', 'a']);
    f.toggleOpen(F);
    expect(f.move(a, F, 'into')).toBe(true);
    expect(names(f.getRoot())).toEqual(['F', 'b']);
    expect(names(f.find(F).children)).toEqual(['a']);
    expect(f.find(F).open).toBe(true); // 入れた先は開く
    // フォルダの中からルートの要素の前へ出す
    expect(f.move(a, b, 'before')).toBe(true);
    expect(names(f.getRoot())).toEqual(['F', 'a', 'b']);
  });

  it('move: 自分自身・自分の配下・ブックマークの中へは移さない', () => {
    const f = createFavorites();
    const F = f.addFolder('F');
    const G = f.addFolder('G', F);
    const a = f.addBookmark('a', '/a');
    expect(f.move(F, F, 'into')).toBe(false);
    expect(f.move(F, G, 'into')).toBe(false);
    expect(f.move(F, G, 'after')).toBe(false);
    expect(f.move(F, a, 'into')).toBe(false);
    expect(f.move('nope', a, 'after')).toBe(false);
    expect(names(f.getRoot())).toEqual(['F', 'a']);
  });

  it('moveBy: 同じ階層で前後へ、端では止まる', () => {
    const { f, a, F } = three();
    expect(f.moveBy(a, 1)).toBe(true);
    expect(names(f.getRoot())).toEqual(['b', 'a', 'F']);
    expect(f.moveBy(F, 1)).toBe(false);
    expect(f.moveBy(a, -5)).toBe(true);
    expect(names(f.getRoot())).toEqual(['a', 'b', 'F']);
  });

  it('indent / outdent: 直前のフォルダへ入れ、出すとそのフォルダの直後へ', () => {
    const f = createFavorites();
    const F = f.addFolder('F');
    const a = f.addBookmark('a', '/a');
    const b = f.addBookmark('b', '/b');
    expect(f.indent(b)).toBe(false); // 直前がブックマーク
    expect(f.indent(a)).toBe(true);
    expect(names(f.find(F).children)).toEqual(['a']);
    expect(f.outdent(a)).toBe(true);
    expect(names(f.getRoot())).toEqual(['F', 'a', 'b']);
    expect(f.outdent(a)).toBe(false); // ルートからは出せない
  });

  it('並べ替えは通知され、保存の並びに反映される', () => {
    const { f, a, b } = three();
    const fn = vi.fn();
    f.subscribe(fn);
    fn.mockClear();
    f.move(b, a, 'before');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(f.toJSON().map((n) => n.name)).toEqual(['b', 'a', 'F']);
  });
});
