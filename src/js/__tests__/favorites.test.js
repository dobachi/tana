import { describe, it, expect, vi } from 'vitest';
import { createFavorites, serialize, searchTree } from '../core/favorites.js';

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
