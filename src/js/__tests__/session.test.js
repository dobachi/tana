import { describe, it, expect, vi } from 'vitest';
import { loadSession, storeSession, createSessionSaver } from '../core/session.js';

function mem(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    _map: map,
  };
}

describe('loadSession / storeSession', () => {
  it('returns null when nothing stored', () => {
    expect(loadSession(mem())).toBeNull();
  });

  it('round-trips dirs and active pane', () => {
    const s = mem();
    storeSession({ dirs: { left: '/a', right: '/b' }, active: 'right' }, s);
    expect(loadSession(s)).toEqual({ dirs: { left: '/a', right: '/b' }, active: 'right' });
  });

  it('normalizes missing/invalid fields', () => {
    const s = mem();
    storeSession({ dirs: { left: '/a' }, active: 'bogus' }, s);
    expect(loadSession(s)).toEqual({ dirs: { left: '/a', right: null }, active: 'left' });
  });

  it('recovers from corrupt data', () => {
    expect(loadSession(mem({ 'tana.session': 'not json' }))).toBeNull();
  });

  it('tolerates throwing storage', () => {
    const bad = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(() => storeSession({ dirs: {} }, bad)).not.toThrow();
    expect(loadSession(bad)).toBeNull();
  });
});

describe('createSessionSaver', () => {
  it('debounces: only saves once for rapid schedules, with latest state', () => {
    let now = { dirs: { left: '/1' }, active: 'left' };
    const stored = [];
    let pending = null;
    const saver = createSessionSaver({
      getState: () => now,
      store: (s) => stored.push(s),
      delay: 100,
      setTimeoutFn: (fn) => {
        pending = fn;
        return 1;
      },
      clearTimeoutFn: () => {
        pending = null;
      },
    });
    saver.schedule();
    now = { dirs: { left: '/2' }, active: 'left' };
    saver.schedule(); // replaces the previous timer
    expect(stored).toHaveLength(0);
    pending(); // fire the (single) timer
    expect(stored).toEqual([{ dirs: { left: '/2' }, active: 'left' }]);
  });

  it('flush saves immediately', () => {
    const store = vi.fn();
    const saver = createSessionSaver({
      getState: () => ({ active: 'right' }),
      store,
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });
    saver.schedule();
    saver.flush();
    expect(store).toHaveBeenCalledWith({ active: 'right' });
  });
});
