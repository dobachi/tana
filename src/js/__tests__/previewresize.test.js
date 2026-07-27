import { describe, it, expect } from 'vitest';
import {
  nextPreviewHeight,
  loadPreviewHeight,
  storePreviewHeight,
  PREVIEW_H,
} from '../core/previewresize.js';

describe('nextPreviewHeight', () => {
  const VH = 1000; // ウィンドウ高さ

  it('上へドラッグすると高くなる（curY < startY）', () => {
    // 開始高さ 200、開始 Y=500、現在 Y=400（100px 上へ）→ 300
    expect(nextPreviewHeight(200, 500, 400, VH)).toBe(300);
  });

  it('下へドラッグすると低くなる', () => {
    expect(nextPreviewHeight(300, 400, 500, VH)).toBe(200);
  });

  it('最小 (PREVIEW_H.MIN) でクランプ', () => {
    expect(nextPreviewHeight(140, 100, 400, VH)).toBe(PREVIEW_H.MIN);
  });

  it('最大 (viewportH * maxFrac) でクランプ', () => {
    const max = Math.floor(VH * PREVIEW_H.MAX_FRAC);
    expect(nextPreviewHeight(200, 400, -10000, VH)).toBe(max);
  });

  it('startY=curY=0 は開始高さをそのままクランプ（復元時の用途）', () => {
    expect(nextPreviewHeight(300, 0, 0, VH)).toBe(300);
    expect(nextPreviewHeight(50, 0, 0, VH)).toBe(PREVIEW_H.MIN); // 小さすぎは min へ
  });
});

describe('load/storePreviewHeight', () => {
  function memStore() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
    };
  }

  it('保存した値を読み戻す', () => {
    const s = memStore();
    storePreviewHeight(321, s);
    expect(loadPreviewHeight(s)).toBe(321);
  });

  it('未保存/不正値は null', () => {
    const s = memStore();
    expect(loadPreviewHeight(s)).toBeNull();
    s.setItem(PREVIEW_H.KEY, 'abc');
    expect(loadPreviewHeight(s)).toBeNull();
  });

  it('丸めて保存する', () => {
    const s = memStore();
    storePreviewHeight(200.7, s);
    expect(loadPreviewHeight(s)).toBe(201);
  });
});
