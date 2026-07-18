import { describe, it, expect } from 'vitest';
import {
  applyClick,
  rangePaths,
  toggleAt,
  selectAll,
  pruneSelection,
  targetEntries,
  describeTargets,
} from '../core/selection.js';

const PATHS = ['/a', '/b', '/c', '/d', '/e'];
const entry = (name) => ({ name, path: '/' + name, is_dir: false });
const ENTRIES = ['a', 'b', 'c', 'd', 'e'].map(entry);

const state = (selected = [], anchor = -1, paths = PATHS) => ({
  paths,
  selected: new Set(selected),
  anchor,
});
const sorted = (set) => [...set].sort();

describe('applyClick — 通常クリック', () => {
  it('その1件だけを選択し、他を解除する', () => {
    const r = applyClick(state(['/a', '/b']), 3);
    expect(sorted(r.selected)).toEqual(['/d']);
  });

  it('クリック位置をアンカーにする', () => {
    expect(applyClick(state(), 2).anchor).toBe(2);
  });

  it('選択済みを再クリックしても選択のまま（解除しない）', () => {
    const r = applyClick(state(['/c']), 2);
    expect(sorted(r.selected)).toEqual(['/c']);
  });
});

describe('applyClick — Ctrl+クリック', () => {
  it('未選択なら追加する', () => {
    const r = applyClick(state(['/a']), 2, { ctrl: true });
    expect(sorted(r.selected)).toEqual(['/a', '/c']);
  });

  it('選択済みなら外す', () => {
    const r = applyClick(state(['/a', '/c']), 2, { ctrl: true });
    expect(sorted(r.selected)).toEqual(['/a']);
  });

  it('トグルした位置を次のアンカーにする', () => {
    expect(applyClick(state(['/a']), 4, { ctrl: true }).anchor).toBe(4);
  });
});

describe('applyClick — Shift+クリック', () => {
  it('アンカーからクリック位置までを選択する', () => {
    const r = applyClick(state([], 1), 3, { shift: true });
    expect(sorted(r.selected)).toEqual(['/b', '/c', '/d']);
  });

  it('アンカーより上にも伸ばせる', () => {
    const r = applyClick(state([], 3), 1, { shift: true });
    expect(sorted(r.selected)).toEqual(['/b', '/c', '/d']);
  });

  it('アンカーは動かさないので、続けて範囲を伸縮できる', () => {
    const first = applyClick(state([], 1), 4, { shift: true });
    expect(first.anchor).toBe(1);
    const second = applyClick({ ...state([], 1), selected: first.selected }, 2, { shift: true });
    expect(sorted(second.selected)).toEqual(['/b', '/c']);
  });

  it('既存の選択は範囲で置き換える', () => {
    const r = applyClick(state(['/e'], 0), 1, { shift: true });
    expect(sorted(r.selected)).toEqual(['/a', '/b']);
  });

  it('アンカー未設定ならクリック位置を起点にする（1件選択）', () => {
    const r = applyClick(state([], -1), 2, { shift: true });
    expect(sorted(r.selected)).toEqual(['/c']);
    expect(r.anchor).toBe(2);
  });
});

describe('applyClick — 範囲外', () => {
  it.each([-1, 5, 99])('index %i では選択を変えない', (i) => {
    const r = applyClick(state(['/a'], 0), i);
    expect(sorted(r.selected)).toEqual(['/a']);
    expect(r.anchor).toBe(0);
  });

  it('元の Set を破壊しない', () => {
    const s = state(['/a']);
    applyClick(s, 2);
    expect(sorted(s.selected)).toEqual(['/a']);
  });
});

describe('rangePaths', () => {
  it('順不同でも同じ範囲を返す', () => {
    expect(rangePaths(PATHS, 1, 3)).toEqual(rangePaths(PATHS, 3, 1));
  });

  it('同じ位置なら1件', () => {
    expect(rangePaths(PATHS, 2, 2)).toEqual(['/c']);
  });

  it('はみ出した範囲はクランプする', () => {
    expect(rangePaths(PATHS, -5, 99)).toEqual(PATHS);
  });

  it('空の一覧では空を返す', () => {
    expect(rangePaths([], 0, 3)).toEqual([]);
  });
});

describe('toggleAt', () => {
  it('選択を反転する', () => {
    expect(sorted(toggleAt(new Set(), PATHS, 1))).toEqual(['/b']);
    expect(sorted(toggleAt(new Set(['/b']), PATHS, 1))).toEqual([]);
  });

  it('範囲外は何もしない', () => {
    expect(sorted(toggleAt(new Set(['/a']), PATHS, 9))).toEqual(['/a']);
  });
});

describe('selectAll', () => {
  it('表示中の全件を選択する', () => {
    expect(sorted(selectAll(PATHS))).toEqual(sorted(new Set(PATHS)));
  });
});

describe('pruneSelection', () => {
  // 隠しファイル表示を切ったり、他プロセスがファイルを消したりすると、
  // 表示に無いパスが選択に残る。それを操作対象にしないための掃除。
  it('表示に無いパスを落とす', () => {
    const r = pruneSelection(new Set(['/a', '/zz']), PATHS);
    expect(sorted(r)).toEqual(['/a']);
  });

  it('全部消えたら空になる', () => {
    expect(pruneSelection(new Set(['/x']), PATHS).size).toBe(0);
  });

  it('表示が空なら空になる', () => {
    expect(pruneSelection(new Set(['/a']), []).size).toBe(0);
  });
});

describe('targetEntries', () => {
  it('選択があればそれを対象にする', () => {
    const t = targetEntries(ENTRIES, new Set(['/b', '/d']), 0);
    expect(t.map((e) => e.name)).toEqual(['b', 'd']);
  });

  it('対象は表示順を保つ（選択した順ではない）', () => {
    const t = targetEntries(ENTRIES, new Set(['/e', '/a']), 0);
    expect(t.map((e) => e.name)).toEqual(['a', 'e']);
  });

  it('選択が無ければカーソル位置の1件', () => {
    expect(targetEntries(ENTRIES, new Set(), 2).map((e) => e.name)).toEqual(['c']);
  });

  it('選択が表示に無いものだけならカーソルに落ちる', () => {
    // 既存のキーボード操作（何も選ばず F5）の挙動を壊さないための保険
    expect(targetEntries(ENTRIES, new Set(['/gone']), 1).map((e) => e.name)).toEqual(['b']);
  });

  it('空の一覧では空を返す', () => {
    expect(targetEntries([], new Set(), 0)).toEqual([]);
  });
});

describe('describeTargets', () => {
  it('1件ならファイル名', () => {
    expect(describeTargets([entry('memo.md')])).toBe('memo.md');
  });

  it('複数なら件数', () => {
    expect(describeTargets(ENTRIES)).toBe('5 件');
  });

  it('空なら空文字', () => {
    expect(describeTargets([])).toBe('');
    expect(describeTargets(null)).toBe('');
  });
});
