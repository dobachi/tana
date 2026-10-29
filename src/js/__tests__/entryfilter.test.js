import { describe, it, expect } from 'vitest';
import {
  NO_FILTER,
  parseExtList,
  normalizeFilter,
  isFilterActive,
  applyEntryFilter,
  describeFilter,
  extOf,
} from '../core/entryfilter.js';

const E = [
  { name: 'docs', is_dir: true },
  { name: 'img.d', is_dir: true },
  { name: 'README.md', is_dir: false },
  { name: 'note.MD', is_dir: false },
  { name: 'a.txt', is_dir: false },
  { name: 'pkg.tar.gz', is_dir: false },
  { name: 'Makefile', is_dir: false },
  { name: '.md', is_dir: false }, // 名前が拡張子だけの隠しファイル
];
const names = (list) => list.map((e) => e.name);

describe('parseExtList', () => {
  it('ドット・ワイルドカード・大小文字・区切りの違いを吸収する', () => {
    expect(parseExtList('md, .TXT  *.pdf;tar.gz、csv')).toEqual([
      'md',
      'txt',
      'pdf',
      'tar.gz',
      'csv',
    ]);
  });
  it('重複・空・パス区切りを含むものは除く', () => {
    expect(parseExtList(' md  .md  , ,  a/b  c\\d ')).toEqual(['md']);
    expect(parseExtList('')).toEqual([]);
    expect(parseExtList(null)).toEqual([]);
  });
});

describe('normalizeFilter / isFilterActive', () => {
  it('壊れた値は「絞り込み無し」', () => {
    expect(normalizeFilter(null)).toEqual(NO_FILTER);
    expect(normalizeFilter({ type: 'bogus', exts: 'md' })).toEqual({ type: 'all', exts: [] });
    expect(isFilterActive(null)).toBe(false);
  });
  it('フォルダだけのときは拡張子を持たない', () => {
    expect(normalizeFilter({ type: 'dirs', exts: ['md'] })).toEqual({ type: 'dirs', exts: [] });
  });
  it('種類か拡張子のどちらかがあれば絞り込み中', () => {
    expect(isFilterActive({ type: 'files' })).toBe(true);
    expect(isFilterActive({ type: 'all', exts: ['.md'] })).toBe(true);
  });
});

describe('applyEntryFilter', () => {
  it('絞り込み無しなら同じ配列を返す', () => {
    expect(applyEntryFilter(E, null)).toBe(E);
  });
  it('フォルダだけ / ファイルだけ', () => {
    expect(names(applyEntryFilter(E, { type: 'dirs' }))).toEqual(['docs', 'img.d']);
    expect(names(applyEntryFilter(E, { type: 'files' }))).toEqual([
      'README.md',
      'note.MD',
      'a.txt',
      'pkg.tar.gz',
      'Makefile',
      '.md',
    ]);
  });
  it('拡張子の指定はファイルに効き、フォルダは移動できるよう残す（大小文字は無視）', () => {
    expect(names(applyEntryFilter(E, { exts: ['md'] }))).toEqual([
      'docs',
      'img.d',
      'README.md',
      'note.MD',
    ]);
  });
  it('拡張子 + ファイルだけならフォルダも消える。複数ドットの拡張子も指定できる', () => {
    expect(names(applyEntryFilter(E, { type: 'files', exts: ['md', 'tar.gz'] }))).toEqual([
      'README.md',
      'note.MD',
      'pkg.tar.gz',
    ]);
    expect(names(applyEntryFilter(E, { type: 'files', exts: ['gz'] }))).toEqual(['pkg.tar.gz']);
  });
  it('名前が拡張子だけ（.md）のファイルは、その拡張子とはみなさない', () => {
    expect(names(applyEntryFilter(E, { type: 'files', exts: ['md'] }))).not.toContain('.md');
  });
});

describe('describeFilter', () => {
  it('状態ごとの説明', () => {
    expect(describeFilter(null)).toBe('');
    expect(describeFilter({ type: 'dirs' })).toBe('フォルダだけ');
    expect(describeFilter({ type: 'files' })).toBe('ファイルだけ');
    expect(describeFilter({ type: 'files', exts: ['md', 'txt'] })).toBe('.md .txt のファイルだけ');
    expect(describeFilter({ exts: ['md'] })).toBe('.md のファイル（とフォルダ）');
  });
});

describe('extOf', () => {
  it('最後のドット以降を小文字で返す。無い・隠しファイル名だけ・末尾ドットは空', () => {
    expect(extOf('README.MD')).toBe('md');
    expect(extOf('pkg.tar.gz')).toBe('gz');
    expect(extOf('Makefile')).toBe('');
    expect(extOf('.bashrc')).toBe('');
    expect(extOf('x.')).toBe('');
    expect(extOf(null)).toBe('');
  });
});
