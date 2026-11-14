import { describe, it, expect } from 'vitest';
import { crumbCollapseRange, collapsePathText, maxPathCollapse } from '../core/crumbfit.js';

describe('crumbCollapseRange', () => {
  it('入り切るなら畳まない', () => {
    expect(crumbCollapseRange([10, 20, 30], 60, 5)).toBeNull();
    expect(crumbCollapseRange([10, 20, 30], 100, 5)).toBeNull();
  });

  it('2 番目から必要な分だけ畳み、末尾側を残す', () => {
    // 合計 100。幅 70 に入れるには 2 番目(20)+3 番目(20) を畳んで 60+…5=65
    expect(crumbCollapseRange([10, 20, 20, 20, 30], 70, 5)).toEqual({ from: 1, to: 3 });
  });

  it('1 つ畳めば足りるなら 1 つだけ', () => {
    expect(crumbCollapseRange([10, 20, 20, 20, 30], 90, 5)).toEqual({ from: 1, to: 2 });
  });

  it('「…」の幅も勘定に入れる', () => {
    // 2 番目(20)を畳んで 80、…が 15 なら 95 > 90 → 3 番目も畳む
    expect(crumbCollapseRange([10, 20, 20, 20, 30], 90, 15)).toEqual({ from: 1, to: 3 });
  });

  it('どこまで畳んでも入らなければ先頭と末尾だけ残す', () => {
    expect(crumbCollapseRange([10, 20, 20, 20, 300], 50, 5)).toEqual({ from: 1, to: 4 });
  });

  it('セグメントが 2 つ以下なら畳めない', () => {
    expect(crumbCollapseRange([100, 200], 50, 5)).toBeNull();
    expect(crumbCollapseRange([500], 50, 5)).toBeNull();
    expect(crumbCollapseRange([], 50, 5)).toBeNull();
  });

  it('表示幅が 0 以下（非表示・未レイアウト）なら何もしない', () => {
    expect(crumbCollapseRange([10, 20, 30, 40], 0, 5)).toBeNull();
    expect(crumbCollapseRange([10, 20, 30, 40], -1, 5)).toBeNull();
    expect(crumbCollapseRange([10, 20, 30, 40], NaN, 5)).toBeNull();
  });

  it('不正な入力でも落ちない', () => {
    expect(crumbCollapseRange(null, 50, 5)).toBeNull();
    expect(crumbCollapseRange([10, -5, NaN, 40, 30], 50, 5)).toEqual({ from: 1, to: 4 });
  });
});

describe('collapsePathText', () => {
  it('先頭と末尾を残して途中を … にする', () => {
    expect(collapsePathText('/home/user/docs/work', 1)).toBe('/…/user/docs/work');
    expect(collapsePathText('/home/user/docs/work', 2)).toBe('/…/docs/work');
    expect(collapsePathText('C:/Users/me/Documents/x', 2)).toBe('C:/…/Documents/x');
  });

  it('畳みすぎは最大（先頭 … 末尾）に丸める', () => {
    expect(collapsePathText('/a/b/c/d', 99)).toBe('/…/d');
    expect(collapsePathText('C:/a/b', 5)).toBe('C:/…/b');
  });

  it('畳めない・k が 0 以下ならそのまま', () => {
    expect(collapsePathText('/a', 1)).toBe('/a');
    expect(collapsePathText('C:/', 1)).toBe('C:/');
    expect(collapsePathText('/a/b/c', 0)).toBe('/a/b/c');
    expect(collapsePathText('', 1)).toBe('');
    expect(collapsePathText(null, 1)).toBeNull();
  });

  it('末尾の / は保つ', () => {
    expect(collapsePathText('/a/b/c/', 1)).toBe('/…/b/c/');
    expect(collapsePathText('/a/b/c/', 9)).toBe('/…/c/');
  });

  it('maxPathCollapse は畳める最大数', () => {
    expect(maxPathCollapse('/a/b/c/d')).toBe(3);
    expect(maxPathCollapse('/a/b/c/')).toBe(2);
    expect(maxPathCollapse('/a')).toBe(0);
    expect(maxPathCollapse(undefined)).toBe(0);
  });
});
