import { describe, it, expect } from 'vitest';
import {
  resolveInputPath,
  pathSegments,
  normalizePath,
  normalizeSeparators,
} from '../core/pathnav.js';

describe('normalizeSeparators', () => {
  it('バックスラッシュを / に統一する', () => {
    expect(normalizeSeparators('C:\\docs\\sub')).toBe('C:/docs/sub');
  });

  it('連続した区切りをまとめる', () => {
    expect(normalizeSeparators('/a//b///c')).toBe('/a/b/c');
  });

  it('末尾の区切りを落とすが、根は残す', () => {
    expect(normalizeSeparators('/a/b/')).toBe('/a/b');
    expect(normalizeSeparators('/')).toBe('/');
    expect(normalizeSeparators('C:/')).toBe('C:/');
  });
});

describe('normalizePath', () => {
  it('. と .. を解決する', () => {
    expect(normalizePath('/a/b/../c/./d')).toBe('/a/c/d');
  });

  it('根より上には登らない', () => {
    expect(normalizePath('/a/../../..')).toBe('/');
    expect(normalizePath('C:/a/../..')).toBe('C:/');
  });
});

describe('resolveInputPath', () => {
  const ctx = { home: '/home/u', cwd: '/home/u/docs' };

  it('絶対パスはそのまま', () => {
    expect(resolveInputPath('/etc/nginx', ctx)).toBe('/etc/nginx');
  });

  it('~ をホームに展開する', () => {
    expect(resolveInputPath('~', ctx)).toBe('/home/u');
    expect(resolveInputPath('~/Downloads', ctx)).toBe('/home/u/Downloads');
  });

  it('相対パスを現在地から解決する', () => {
    expect(resolveInputPath('sub', ctx)).toBe('/home/u/docs/sub');
    expect(resolveInputPath('../other', ctx)).toBe('/home/u/other');
    expect(resolveInputPath('./sub', ctx)).toBe('/home/u/docs/sub');
  });

  it('Windows の絶対パスを扱う', () => {
    expect(resolveInputPath('C:\\Users\\me', ctx)).toBe('C:/Users/me');
  });

  it('前後の空白を落とす', () => {
    expect(resolveInputPath('  /etc  ', ctx)).toBe('/etc');
  });

  // コピペしたパスは引用符付きになりがち（ファイルマネージャや端末から）
  it('前後の引用符を落とす', () => {
    expect(resolveInputPath('"/etc/nginx"', ctx)).toBe('/etc/nginx');
    expect(resolveInputPath("'/etc/nginx'", ctx)).toBe('/etc/nginx');
  });

  it('末尾の区切りを落とす', () => {
    expect(resolveInputPath('/etc/nginx/', ctx)).toBe('/etc/nginx');
  });

  it('空入力や解決できないものは null', () => {
    expect(resolveInputPath('', ctx)).toBeNull();
    expect(resolveInputPath('   ', ctx)).toBeNull();
    expect(resolveInputPath(null, ctx)).toBeNull();
    expect(resolveInputPath(undefined, ctx)).toBeNull();
  });

  it('ホーム未知なら ~ は解決しない', () => {
    expect(resolveInputPath('~/docs', { cwd: '/tmp' })).toBeNull();
  });

  it('現在地未知なら相対パスは解決しない', () => {
    expect(resolveInputPath('sub', { home: '/home/u' })).toBeNull();
  });
});

describe('pathSegments', () => {
  it('POSIX のパスを根から分解する', () => {
    expect(pathSegments('/home/u/docs')).toEqual([
      { name: '/', path: '/' },
      { name: 'home', path: '/home' },
      { name: 'u', path: '/home/u' },
      { name: 'docs', path: '/home/u/docs' },
    ]);
  });

  it('根そのものは1要素', () => {
    expect(pathSegments('/')).toEqual([{ name: '/', path: '/' }]);
  });

  it('Windows のドライブを根として扱う', () => {
    expect(pathSegments('C:\\Users\\me')).toEqual([
      { name: 'C:', path: 'C:/' },
      { name: 'Users', path: 'C:/Users' },
      { name: 'me', path: 'C:/Users/me' },
    ]);
  });

  it('末尾の区切りがあっても余分な要素を作らない', () => {
    expect(pathSegments('/home/u/')).toEqual([
      { name: '/', path: '/' },
      { name: 'home', path: '/home' },
      { name: 'u', path: '/home/u' },
    ]);
  });

  it('空や非文字列は空配列', () => {
    expect(pathSegments('')).toEqual([]);
    expect(pathSegments(null)).toEqual([]);
    expect(pathSegments(undefined)).toEqual([]);
  });

  it('日本語や空白を含む名前をそのまま保つ', () => {
    expect(pathSegments('/home/u/私の 書類')).toEqual([
      { name: '/', path: '/' },
      { name: 'home', path: '/home' },
      { name: 'u', path: '/home/u' },
      { name: '私の 書類', path: '/home/u/私の 書類' },
    ]);
  });
});
