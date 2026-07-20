import { describe, it, expect } from 'vitest';
import {
  sortEntries,
  nextSort,
  extOf,
  defaultCollator,
  DEFAULT_SORT,
  SORT_KEYS,
} from '../core/sort.js';

const col = defaultCollator();
const dir = (name) => ({ name, path: '/' + name, is_dir: true, size: 0, modified: 0 });
const file = (name, size = 0, modified = 0) => ({
  name,
  path: '/' + name,
  is_dir: false,
  size,
  modified,
});

const names = (arr) => arr.map((e) => e.name);

describe('extOf', () => {
  it('lowercased extension or empty', () => {
    expect(extOf('a.TXT')).toBe('txt');
    expect(extOf('archive.tar.gz')).toBe('gz');
    expect(extOf('README')).toBe('');
    expect(extOf('.hidden')).toBe('');
  });
});

describe('sortEntries — name (natural)', () => {
  it('sorts names in natural (numeric-aware) order', () => {
    const input = [file('file10'), file('file2'), file('file1')];
    expect(names(sortEntries(input, { key: 'name', dir: 'asc' }, col))).toEqual([
      'file1',
      'file2',
      'file10',
    ]);
  });

  it('is case-insensitive', () => {
    const input = [file('Banana'), file('apple'), file('Cherry')];
    expect(names(sortEntries(input, { key: 'name', dir: 'asc' }, col))).toEqual([
      'apple',
      'Banana',
      'Cherry',
    ]);
  });

  it('descending reverses', () => {
    const input = [file('a'), file('b'), file('c')];
    expect(names(sortEntries(input, { key: 'name', dir: 'desc' }, col))).toEqual(['c', 'b', 'a']);
  });
});

describe('sortEntries — folders first', () => {
  it('keeps folders on top regardless of direction', () => {
    const input = [file('b.txt'), dir('zdir'), file('a.txt'), dir('adir')];
    expect(names(sortEntries(input, { key: 'name', dir: 'asc' }, col))).toEqual([
      'adir',
      'zdir',
      'a.txt',
      'b.txt',
    ]);
    // desc: folders still first (but among themselves reversed)
    expect(names(sortEntries(input, { key: 'name', dir: 'desc' }, col))).toEqual([
      'zdir',
      'adir',
      'b.txt',
      'a.txt',
    ]);
  });

  it('foldersFirst=false mixes them', () => {
    const input = [dir('mdir'), file('a.txt'), file('z.txt')];
    expect(
      names(sortEntries(input, { key: 'name', dir: 'asc', foldersFirst: false }, col)),
    ).toEqual(['a.txt', 'mdir', 'z.txt']);
  });
});

describe('sortEntries — size / modified with name tie-break', () => {
  it('sorts by size, ties broken by name', () => {
    const input = [file('b', 100), file('a', 100), file('c', 50)];
    expect(names(sortEntries(input, { key: 'size', dir: 'asc' }, col))).toEqual(['c', 'a', 'b']);
  });
  it('sorts by modified', () => {
    const input = [file('a', 0, 300), file('b', 0, 100), file('c', 0, 200)];
    expect(names(sortEntries(input, { key: 'modified', dir: 'asc' }, col))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
});

describe('sortEntries — ext', () => {
  it('sorts by extension', () => {
    const input = [file('a.zip'), file('b.md'), file('c.txt')];
    expect(names(sortEntries(input, { key: 'ext', dir: 'asc' }, col))).toEqual([
      'b.md',
      'c.txt',
      'a.zip',
    ]);
  });
});

describe('sortEntries — robustness', () => {
  it('does not mutate input and handles unknown key', () => {
    const input = [file('b'), file('a')];
    const copy = [...input];
    const out = sortEntries(input, { key: 'nonsense' }, col);
    expect(input).toEqual(copy); // unchanged
    expect(names(out)).toEqual(['a', 'b']); // falls back to name
  });
});

describe('nextSort', () => {
  it('toggles direction on same key, resets to asc on new key', () => {
    expect(nextSort(DEFAULT_SORT, 'name')).toMatchObject({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toMatchObject({
      key: 'name',
      dir: 'asc',
    });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'size')).toMatchObject({
      key: 'size',
      dir: 'asc',
    });
  });
  it('ignores unknown key', () => {
    expect(nextSort({ key: 'size', dir: 'asc' }, 'bogus')).toMatchObject({ key: 'size' });
  });
  it('SORT_KEYS covers the expected set', () => {
    expect(SORT_KEYS).toContain('name');
    expect(SORT_KEYS).toContain('modified');
  });
});
