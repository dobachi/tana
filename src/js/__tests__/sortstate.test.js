import { describe, it, expect } from 'vitest';
import { createSortState, loadStoredSort, storeSort } from '../core/sortstate.js';
import { DEFAULT_SORT } from '../core/sort.js';

describe('createSortState', () => {
  it('defaults to name/asc/foldersFirst', () => {
    const s = createSortState();
    expect(s.get()).toEqual({ key: 'name', dir: 'asc', foldersFirst: true });
  });

  it('applyKey toggles direction on same key, resets on new key', () => {
    const s = createSortState();
    expect(s.applyKey('name')).toMatchObject({ key: 'name', dir: 'desc' });
    expect(s.applyKey('name')).toMatchObject({ key: 'name', dir: 'asc' });
    expect(s.applyKey('size')).toMatchObject({ key: 'size', dir: 'asc' });
  });

  it('set and reverse work', () => {
    const s = createSortState();
    expect(s.set({ key: 'modified', dir: 'desc' })).toMatchObject({ key: 'modified', dir: 'desc' });
    expect(s.reverse()).toMatchObject({ dir: 'asc' });
  });

  it('notifies subscribers on change', () => {
    const s = createSortState();
    const seen = [];
    s.subscribe((st) => seen.push(st.key)); // immediate: 'name'
    s.applyKey('size');
    expect(seen).toEqual(['name', 'size']);
  });

  it('normalizes invalid input', () => {
    const s = createSortState({ key: 'bogus', dir: 'weird', foldersFirst: false });
    expect(s.get()).toEqual({ key: DEFAULT_SORT.key, dir: 'asc', foldersFirst: false });
  });
});

describe('loadStoredSort / storeSort', () => {
  function mem(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
  }

  it('returns defaults when empty or corrupt', () => {
    expect(loadStoredSort(mem())).toEqual(DEFAULT_SORT);
    expect(loadStoredSort(mem({ 'tana.sort': 'not json' }))).toEqual(DEFAULT_SORT);
  });

  it('round-trips', () => {
    const s = mem();
    storeSort({ key: 'size', dir: 'desc', foldersFirst: true }, s);
    expect(loadStoredSort(s)).toEqual({ key: 'size', dir: 'desc', foldersFirst: true });
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
    expect(() => storeSort({ key: 'name' }, bad)).not.toThrow();
    expect(loadStoredSort(bad)).toEqual(DEFAULT_SORT);
  });
});
