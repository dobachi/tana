import { describe, it, expect } from 'vitest';
import { createPreviewZoom } from '../core/previewzoom.js';

describe('createPreviewZoom', () => {
  it('既定はフィット', () => {
    const z = createPreviewZoom();
    expect(z.get()).toBe('fit');
    expect(z.isFit()).toBe(true);
  });

  it('toggle でフィット⇄実寸を往復し、切替後のモードを返す', () => {
    const z = createPreviewZoom();
    expect(z.toggle()).toBe('actual');
    expect(z.isFit()).toBe(false);
    expect(z.toggle()).toBe('fit');
    expect(z.isFit()).toBe(true);
  });

  it('reset はフィットへ戻す（実寸のままでも）', () => {
    const z = createPreviewZoom();
    z.toggle(); // actual
    z.reset();
    expect(z.get()).toBe('fit');
  });

  it('複数インスタンスは独立', () => {
    const a = createPreviewZoom();
    const b = createPreviewZoom();
    a.toggle();
    expect(a.get()).toBe('actual');
    expect(b.get()).toBe('fit');
  });
});
