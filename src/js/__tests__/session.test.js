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
    expect(loadSession(s)).toEqual({
      dirs: { left: '/a', right: '/b' },
      active: 'right',
      tabs: { left: null, right: null },
      activeTab: { left: 0, right: 0 },
    });
  });

  it('normalizes missing/invalid fields', () => {
    const s = mem();
    storeSession({ dirs: { left: '/a' }, active: 'bogus' }, s);
    expect(loadSession(s)).toEqual({
      dirs: { left: '/a', right: null },
      active: 'left',
      tabs: { left: null, right: null },
      activeTab: { left: 0, right: 0 },
    });
  });

  it('round-trips tab configuration (FR-08/FR-14)', () => {
    const s = mem();
    storeSession(
      {
        dirs: { left: '/a2', right: '/b' },
        active: 'left',
        tabs: { left: ['/a1', '/a2', '/a3'], right: ['/b'] },
        activeTab: { left: 1, right: 0 },
      },
      s,
    );
    const got = loadSession(s);
    expect(got.tabs).toEqual({ left: ['/a1', '/a2', '/a3'], right: ['/b'] });
    expect(got.activeTab).toEqual({ left: 1, right: 0 });
  });

  it('filters non-string tab entries and empties to null; clamps index', () => {
    const s = mem();
    storeSession(
      {
        dirs: {},
        active: 'left',
        tabs: { left: ['/a', 3, null, '/c'], right: [] },
        activeTab: { left: -5, right: 2.5 },
      },
      s,
    );
    const got = loadSession(s);
    expect(got.tabs).toEqual({ left: ['/a', '/c'], right: null });
    expect(got.activeTab).toEqual({ left: 0, right: 0 });
  });

  it('backward compatible with sessions saved before tabs existed', () => {
    // 旧フォーマット（tabs / activeTab なし）を直接置いて読む
    const s = mem({ 'tana.session': JSON.stringify({ dirs: { left: '/old' }, active: 'left' }) });
    const got = loadSession(s);
    expect(got.tabs).toEqual({ left: null, right: null });
    expect(got.activeTab).toEqual({ left: 0, right: 0 });
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
