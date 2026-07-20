import { describe, it, expect, vi } from 'vitest';
import {
  createPreviewPlacement,
  loadStoredPlacement,
  storePlacement,
  DEFAULT_PLACEMENT,
  DEFAULT_RATIO,
} from '../core/previewplacement.js';

describe('createPreviewPlacement', () => {
  it('defaults to closed / default placement / default ratio', () => {
    const p = createPreviewPlacement();
    expect(p.get()).toEqual({ open: false, placement: DEFAULT_PLACEMENT, ratio: DEFAULT_RATIO });
    expect(p.isOpen()).toBe(false);
  });

  it('open/close/toggle emit only on change', () => {
    const p = createPreviewPlacement();
    const seen = [];
    p.subscribe((s) => seen.push(s.open)); // fires immediately with false
    p.open();
    p.open(); // no-op
    p.close();
    p.toggle(); // → true
    expect(seen).toEqual([false, true, false, true]);
  });

  it('togglePlacement flips right/bottom', () => {
    const p = createPreviewPlacement({ placement: 'right' });
    expect(p.togglePlacement()).toBe('bottom');
    expect(p.togglePlacement()).toBe('right');
  });

  it('clamps ratio into range', () => {
    const p = createPreviewPlacement();
    expect(p.setRatio(0.01)).toBeCloseTo(0.15);
    expect(p.setRatio(0.99)).toBeCloseTo(0.7);
    expect(p.setRatio(0.4)).toBeCloseTo(0.4);
    expect(p.setRatio('bad')).toBeCloseTo(0.4); // unchanged (invalid → default clamp)
  });

  it('rejects invalid placement, keeps current', () => {
    const p = createPreviewPlacement({ placement: 'bottom' });
    expect(p.setPlacement('nonsense')).toBe('bottom');
    expect(p.setPlacement('right')).toBe('right');
  });
});

describe('loadStoredPlacement / storePlacement', () => {
  function memStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
      _map: map,
    };
  }

  it('returns defaults when nothing stored', () => {
    expect(loadStoredPlacement(memStorage())).toEqual({
      open: false,
      placement: DEFAULT_PLACEMENT,
      ratio: DEFAULT_RATIO,
    });
  });

  it('round-trips a stored value', () => {
    const s = memStorage();
    storePlacement({ open: true, placement: 'bottom', ratio: 0.5 }, s);
    expect(loadStoredPlacement(s)).toEqual({ open: true, placement: 'bottom', ratio: 0.5 });
  });

  it('recovers from corrupt / invalid stored data', () => {
    expect(loadStoredPlacement(memStorage({ 'tana.preview': 'not json' }))).toEqual({
      open: false,
      placement: DEFAULT_PLACEMENT,
      ratio: DEFAULT_RATIO,
    });
    const s = memStorage({ 'tana.preview': JSON.stringify({ placement: 'x', ratio: 9 }) });
    const loaded = loadStoredPlacement(s);
    expect(loaded.placement).toBe(DEFAULT_PLACEMENT);
    expect(loaded.ratio).toBeCloseTo(0.7); // 9 clamped
  });

  it('tolerates a throwing storage', () => {
    const bad = {
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('nope');
      },
    };
    expect(() => storePlacement({ open: true }, bad)).not.toThrow();
    expect(loadStoredPlacement(bad)).toEqual({
      open: false,
      placement: DEFAULT_PLACEMENT,
      ratio: DEFAULT_RATIO,
    });
  });
});
