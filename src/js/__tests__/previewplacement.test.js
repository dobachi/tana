import { describe, it, expect } from 'vitest';
import {
  createPreviewPlacement,
  loadStoredPlacement,
  storePlacement,
  DEFAULT_RATIO,
} from '../core/previewplacement.js';

describe('createPreviewPlacement', () => {
  it('defaults to closed / default ratio', () => {
    const p = createPreviewPlacement();
    expect(p.get()).toEqual({ open: false, ratio: DEFAULT_RATIO });
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

  it('clamps ratio into range, ignores invalid', () => {
    const p = createPreviewPlacement();
    expect(p.setRatio(0.01)).toBeCloseTo(0.15);
    expect(p.setRatio(0.99)).toBeCloseTo(0.7);
    expect(p.setRatio(0.4)).toBeCloseTo(0.4);
    expect(p.setRatio('bad')).toBeCloseTo(0.4); // unchanged
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
    expect(loadStoredPlacement(memStorage())).toEqual({ open: false, ratio: DEFAULT_RATIO });
  });

  it('round-trips a stored value', () => {
    const s = memStorage();
    storePlacement({ open: true, ratio: 0.5 }, s);
    expect(loadStoredPlacement(s)).toEqual({ open: true, ratio: 0.5 });
  });

  it('recovers from corrupt / invalid stored data', () => {
    expect(loadStoredPlacement(memStorage({ 'tana.preview': 'not json' }))).toEqual({
      open: false,
      ratio: DEFAULT_RATIO,
    });
    const s = memStorage({ 'tana.preview': JSON.stringify({ ratio: 9 }) });
    expect(loadStoredPlacement(s).ratio).toBeCloseTo(0.7); // 9 clamped
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
    expect(loadStoredPlacement(bad)).toEqual({ open: false, ratio: DEFAULT_RATIO });
  });
});
