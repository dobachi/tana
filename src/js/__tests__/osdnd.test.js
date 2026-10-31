import { describe, it, expect } from 'vitest';
import {
  toClientPoint,
  isOutsideViewport,
  isNearEdge,
  sourcesFromKinds,
  planDragOut,
  describeDragOutRefusal,
  matchOutbound,
  dragOutLabel,
  FALLBACK_DRAG_ICON,
} from '../core/osdnd.js';

const remote = (p) => p.startsWith('sftp://');

describe('toClientPoint — 物理ピクセルを CSS ピクセルへ', () => {
  it('倍率で割る（150%）', () => {
    expect(toClientPoint({ x: 300, y: 150 }, 1.5)).toEqual({ x: 200, y: 100 });
  });
  it('倍率 1 ならそのまま', () => {
    expect(toClientPoint({ x: 10, y: 20 }, 1)).toEqual({ x: 10, y: 20 });
  });
  it('倍率が 0 や不正なら 1 とみなす', () => {
    expect(toClientPoint({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
    expect(toClientPoint({ x: 10, y: 20 }, undefined)).toEqual({ x: 10, y: 20 });
  });
  it('座標が無ければ null', () => {
    expect(toClientPoint(null, 1)).toBeNull();
  });
});

describe('isOutsideViewport', () => {
  it('内側は false', () => {
    expect(isOutsideViewport({ x: 0, y: 0 }, 100, 50)).toBe(false);
    expect(isOutsideViewport({ x: 99, y: 49 }, 100, 50)).toBe(false);
  });
  it('負の座標・幅/高さちょうど以上は外', () => {
    expect(isOutsideViewport({ x: -1, y: 10 }, 100, 50)).toBe(true);
    expect(isOutsideViewport({ x: 10, y: -1 }, 100, 50)).toBe(true);
    expect(isOutsideViewport({ x: 100, y: 10 }, 100, 50)).toBe(true);
    expect(isOutsideViewport({ x: 10, y: 50 }, 100, 50)).toBe(true);
  });
  it('座標なしは false', () => {
    expect(isOutsideViewport(null, 100, 50)).toBe(false);
  });
});

describe('isNearEdge', () => {
  it('縁（2px 以内）と外は true、中央は false', () => {
    expect(isNearEdge({ x: 1, y: 25 }, 100, 50)).toBe(true);
    expect(isNearEdge({ x: 98, y: 25 }, 100, 50)).toBe(true);
    expect(isNearEdge({ x: 50, y: 49 }, 100, 50)).toBe(true);
    expect(isNearEdge({ x: -5, y: 25 }, 100, 50)).toBe(true);
    expect(isNearEdge({ x: 50, y: 25 }, 100, 50)).toBe(false);
    expect(isNearEdge({ x: 3, y: 3 }, 100, 50)).toBe(false);
  });
});

describe('sourcesFromKinds', () => {
  it('存在するものだけをエントリにする', () => {
    const got = sourcesFromKinds([
      { path: '/a/d', name: 'd', is_dir: true, exists: true },
      { path: '/a/gone', name: 'gone', is_dir: false, exists: false },
      { path: '/a/f.txt', name: 'f.txt', is_dir: false, exists: true },
    ]);
    expect(got).toEqual([
      { path: '/a/d', name: 'd', is_dir: true },
      { path: '/a/f.txt', name: 'f.txt', is_dir: false },
    ]);
  });
  it('名前が無ければパスを使う / 配列でなければ空', () => {
    expect(sourcesFromKinds([{ path: '/x', exists: true }])[0].name).toBe('/x');
    expect(sourcesFromKinds(null)).toEqual([]);
  });
});

describe('planDragOut — OS へ渡すもの', () => {
  it('ローカルはそのまま、リモートのファイルは取り寄せ対象', () => {
    const plan = planDragOut(
      [
        { path: '/l/a.txt', is_dir: false },
        { path: '/l/dir', is_dir: true },
        { path: 'sftp://h/r/b.txt', is_dir: false },
      ],
      remote,
    );
    expect(plan).toEqual({
      ok: true,
      items: [
        { path: '/l/a.txt', remote: false },
        { path: '/l/dir', remote: false },
        { path: 'sftp://h/r/b.txt', remote: true },
      ],
    });
  });
  it('リモートのフォルダが混じると断る', () => {
    const plan = planDragOut(
      [
        { path: '/l/a.txt', is_dir: false },
        { path: 'sftp://h/r/dir', is_dir: true },
      ],
      remote,
    );
    expect(plan).toEqual({ ok: false, reason: 'remote-dir' });
    expect(describeDragOutRefusal('remote-dir')).toMatch('リモートのフォルダ');
  });
  it('空は断る（文言なし）', () => {
    expect(planDragOut([], remote)).toEqual({ ok: false, reason: 'empty' });
    expect(planDragOut(null, remote).ok).toBe(false);
    expect(describeDragOutRefusal('empty')).toBe('');
  });
});

describe('matchOutbound — 外へ出したものが戻ってきたか', () => {
  const out = {
    paths: ['/tmp/cache/h/r/b.txt', '/l/a.txt'],
    sources: [{ path: 'sftp://h/r/b.txt' }, { path: '/l/a.txt' }],
  };
  it('同じ集合なら元の対象（順不同）', () => {
    expect(matchOutbound(out, ['/l/a.txt', '/tmp/cache/h/r/b.txt'])).toBe(out.sources);
  });
  it('一部だけ・別物・件数違いは null', () => {
    expect(matchOutbound(out, ['/l/a.txt'])).toBeNull();
    expect(matchOutbound(out, ['/l/a.txt', '/l/other'])).toBeNull();
    expect(matchOutbound(null, ['/l/a.txt'])).toBeNull();
    expect(matchOutbound(out, [])).toBeNull();
  });
});

describe('dragOutLabel / FALLBACK_DRAG_ICON', () => {
  it('1件は名前、複数は件数', () => {
    expect(dragOutLabel([{ name: 'a.txt' }])).toBe('a.txt');
    expect(dragOutLabel([{ name: 'a' }, { name: 'b' }])).toBe('2 件');
    expect(dragOutLabel([])).toBe('');
  });
  it('代替アイコンは plugin が受け付ける PNG の data URL', () => {
    expect(FALLBACK_DRAG_ICON.startsWith('data:image/png;base64,')).toBe(true);
  });
});
