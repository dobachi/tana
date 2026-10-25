import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeView,
  createFavViewState,
  loadFavView,
  storeFavView,
  sortTree,
  sortFlat,
  parseQuery,
  matchesQuery,
  flatten,
  pruneTree,
  groupTree,
  dropPosition,
  describeView,
  DEFAULT_VIEW,
  VIEW_KEY,
} from '../core/favarrange.js';

const bm = (name, path, extra = {}) => ({ id: name, type: 'bookmark', name, path, ...extra });
const folder = (name, children, extra = {}) => ({
  id: name,
  type: 'folder',
  name,
  open: true,
  children,
  ...extra,
});
const names = (list) => list.map((n) => n.name);

describe('sanitizeView / 状態', () => {
  it('不正な値は既定に戻す', () => {
    expect(sanitizeView(null)).toEqual({ ...DEFAULT_VIEW, collapsed: [] });
    expect(
      sanitizeView({ sort: 'x', order: 'up', group: 'y', tag: 3, collapsed: ['a', 'a', 1] }),
    ).toEqual({ ...DEFAULT_VIEW, collapsed: ['a'] });
    expect(sanitizeView({ sort: 'name', order: 'desc', group: 'tag', tag: 'w' })).toMatchObject({
      sort: 'name',
      order: 'desc',
      group: 'tag',
      tag: 'w',
    });
  });

  it('update と見出しの開閉を通知する', () => {
    const s = createFavViewState();
    const fn = vi.fn();
    s.subscribe(fn);
    s.update({ sort: 'added' });
    expect(s.get().sort).toBe('added');
    expect(s.toggleCollapsed('local')).toBe(true);
    expect(s.isCollapsed('local')).toBe(true);
    expect(s.toggleCollapsed('local')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('保存と読み込み（壊れていたら既定）', () => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    storeFavView(
      { sort: 'name', order: 'desc', group: 'host', tag: null, collapsed: ['x'] },
      storage,
    );
    expect(loadFavView(storage)).toMatchObject({ sort: 'name', group: 'host', collapsed: ['x'] });
    mem.set(VIEW_KEY, '{broken');
    expect(loadFavView(storage)).toEqual(sanitizeView(null));
  });
});

describe('sortTree / sortFlat', () => {
  const tree = [
    bm('b10', '/b10', { added: 3 }),
    folder('Z', [bm('y', '/y', { added: 9 }), bm('x', '/x', { added: 1 })], { added: 2 }),
    bm('b2', '/b2'),
    folder('A', [], { added: 5 }),
    bm('あ', '/a', { added: 4 }),
  ];

  it('手動は保存の並びそのもの', () => {
    expect(sortTree(tree, { sort: 'manual', order: 'desc' })).toBe(tree);
  });

  it('名前順: フォルダを先頭に、数字は数として、配下も並べる', () => {
    const out = sortTree(tree, { sort: 'name', order: 'asc' });
    expect(names(out)).toEqual(['A', 'Z', 'b2', 'b10', 'あ']);
    expect(names(out[1].children)).toEqual(['x', 'y']);
    expect(names(tree)).toEqual(['b10', 'Z', 'b2', 'A', 'あ']); // 元は変えない
    expect(names(sortTree(tree, { sort: 'name', order: 'desc' }))).toEqual([
      'Z',
      'A',
      'あ',
      'b10',
      'b2',
    ]);
  });

  it('登録日順: 日時の無い古いデータは最も古い扱い', () => {
    const asc = sortTree(tree, { sort: 'added', order: 'asc' });
    expect(names(asc)).toEqual(['Z', 'A', 'b2', 'b10', 'あ']);
    expect(names(asc[0].children)).toEqual(['x', 'y']);
    expect(names(sortTree(tree, { sort: 'added', order: 'desc' }))).toEqual([
      'A',
      'Z',
      'あ',
      'b10',
      'b2',
    ]);
  });

  it('平坦な結果も同じ規則で並べる', () => {
    const items = [{ node: bm('b', '/b') }, { node: bm('a', '/a') }];
    expect(sortFlat(items, { sort: 'manual' })).toBe(items);
    expect(sortFlat(items, { sort: 'name', order: 'asc' }).map((i) => i.node.name)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('絞り込み（検索語と #タグ）', () => {
  it('parseQuery は #付きをタグに分ける', () => {
    expect(parseQuery(' #Work 提案  doc ')).toEqual({ text: '提案 doc', tags: ['work'] });
    expect(parseQuery('#')).toEqual({ text: '#', tags: [] });
    expect(parseQuery('')).toEqual({ text: '', tags: [] });
  });

  it('matchesQuery は語をすべて・タグをすべて含むものだけ', () => {
    const n = bm('提案書', '/work/doc', { tags: ['Work', 'q3'] });
    expect(matchesQuery(n, parseQuery('提案 work'))).toBe(true);
    expect(matchesQuery(n, parseQuery('#work #Q3'))).toBe(true);
    expect(matchesQuery(n, parseQuery('#home'))).toBe(false);
    expect(matchesQuery(n, parseQuery('提案 zzz'))).toBe(false);
    expect(matchesQuery(n, parseQuery(''), 'q3')).toBe(true); // チップで選んだタグ
    expect(matchesQuery(n, parseQuery(''), 'x')).toBe(false);
    expect(matchesQuery(folder('F', []), parseQuery(''))).toBe(false);
  });

  it('flatten はパンくず付き、pruneTree は空のフォルダを消す', () => {
    const tree = [folder('F', [bm('a', '/a'), folder('G', [bm('b', '/b')])]), bm('c', '/c')];
    const flat = flatten(tree, (n) => n.name !== 'c');
    expect(flat.map((i) => [i.node.name, i.breadcrumb])).toEqual([
      ['a', ['F']],
      ['b', ['F', 'G']],
    ]);
    const pruned = pruneTree(tree, (n) => n.name === 'b');
    expect(names(pruned)).toEqual(['F']);
    expect(names(pruned[0].children)).toEqual(['G']);
  });
});

describe('groupTree', () => {
  const tree = [
    bm('l1', '/home/u', { tags: ['work'] }),
    folder('F', [bm('r1', 'sftp://k16/a', { tags: ['work', 'srv'] }), bm('l2', '/tmp')]),
    bm('r2', 'sftp://alpha/b'),
  ];

  it('接続先ごと: このPC → 接続先の名前順。フォルダ構造は保つ', () => {
    const g = groupTree(tree, 'host');
    expect(g.map((x) => [x.key, x.label, x.count])).toEqual([
      ['local', 'このPC', 2],
      ['host:alpha', 'alpha', 1],
      ['host:k16', 'k16', 1],
    ]);
    expect(names(g[0].nodes)).toEqual(['l1', 'F']);
    expect(names(g[0].nodes[1].children)).toEqual(['l2']);
    expect(names(g[2].nodes[0].children)).toEqual(['r1']);
  });

  it('タグごと: 複数タグは各見出しに、タグなしは最後', () => {
    const g = groupTree(tree, 'tag');
    expect(g.map((x) => [x.key, x.label, x.count])).toEqual([
      ['tag:srv', '#srv', 1],
      ['tag:work', '#work', 2],
      ['notag', 'タグなし', 2],
    ]);
  });

  it('まとめない・空なら見出しは無い', () => {
    expect(groupTree(tree, 'none')).toEqual([]);
    expect(groupTree([], 'host')).toEqual([]);
  });
});

describe('dropPosition', () => {
  it('フォルダは上下 1/4 が前後、中央が中', () => {
    expect(dropPosition(2, 20, true)).toBe('before');
    expect(dropPosition(10, 20, true)).toBe('into');
    expect(dropPosition(18, 20, true)).toBe('after');
  });
  it('ブックマークは上半分が前、下半分が後ろ。高さ不明なら後ろ', () => {
    expect(dropPosition(4, 20, false)).toBe('before');
    expect(dropPosition(12, 20, false)).toBe('after');
    expect(dropPosition(5, 0, true)).toBe('after');
  });
});

describe('describeView', () => {
  it('並べ方とまとめ方を短く言う', () => {
    expect(describeView(null)).toBe('手動');
    expect(describeView({ sort: 'added', order: 'desc', group: 'host' })).toBe(
      '登録日順・降順 / 接続先でまとめる',
    );
  });
});
