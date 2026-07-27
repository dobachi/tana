import { describe, it, expect } from 'vitest';
import { createPreviewZoom, clampScale, wheelZoomDir, ZOOM } from '../core/previewzoom.js';

describe('clampScale', () => {
  it('範囲内はそのまま、外は端に丸める', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(100)).toBe(ZOOM.MAX);
    expect(clampScale(0)).toBe(ZOOM.MIN);
  });
  it('非有限値(NaN/Infinity)は 1 に倒す', () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity)).toBe(1);
    expect(clampScale(-Infinity)).toBe(1);
  });
});

describe('wheelZoomDir', () => {
  it('上=拡大 +1 / 下=縮小 -1 / 0', () => {
    expect(wheelZoomDir({ deltaY: -3 })).toBe(1);
    expect(wheelZoomDir({ deltaY: 5 })).toBe(-1);
    expect(wheelZoomDir({ deltaY: 0 })).toBe(0);
    expect(wheelZoomDir(null)).toBe(0);
  });
});

describe('createPreviewZoom', () => {
  it('既定はフィット', () => {
    const z = createPreviewZoom();
    expect(z.get()).toEqual({ mode: 'fit', scale: 1 });
    expect(z.isFit()).toBe(true);
  });

  it('toggle でフィット⇄実寸(zoom@1)を往復', () => {
    const z = createPreviewZoom();
    expect(z.toggle()).toBe('zoom');
    expect(z.get()).toEqual({ mode: 'zoom', scale: 1 });
    expect(z.isFit()).toBe(false);
    expect(z.toggle()).toBe('fit');
    expect(z.isFit()).toBe(true);
  });

  it('reset はフィット・倍率1へ戻す', () => {
    const z = createPreviewZoom();
    z.zoom(1);
    z.reset();
    expect(z.get()).toEqual({ mode: 'fit', scale: 1 });
  });

  it('フィットからの zoom(+1) は実寸(1.0)起点で1段拡大', () => {
    const z = createPreviewZoom({ step: 2 });
    const s = z.zoom(1);
    expect(z.get().mode).toBe('zoom');
    expect(s).toBe(2); // 1 * 2^1
  });

  it('連続ズームは倍率を掛け合わせ、上下限でクランプ', () => {
    const z = createPreviewZoom({ step: 2, min: 0.5, max: 8 });
    expect(z.zoom(1)).toBe(2);
    expect(z.zoom(1)).toBe(4);
    expect(z.zoom(1)).toBe(8);
    expect(z.zoom(1)).toBe(8); // max でクランプ
    z.reset();
    expect(z.zoom(-1)).toBe(0.5); // 1 * 2^-1 = 0.5 = min
    expect(z.zoom(-1)).toBe(0.5); // min でクランプ
  });
});
