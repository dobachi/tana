import { describe, it, expect, vi } from 'vitest';
import {
  createRemotes,
  hostCandidates,
  targetUri,
  loadStoredRemotes,
  storeRemotes,
  STORAGE_KEY,
  MAX_RECENT,
} from '../core/remotes.js';

describe('createRemotes', () => {
  it('touch で最近の先頭へ（重複なし）と最後の場所を記録', () => {
    const r = createRemotes();
    r.touch('a', 'sftp://a/x');
    r.touch('b');
    r.touch('a', 'sftp://a/y');
    expect(r.recent()).toEqual(['a', 'b']);
    expect(r.lastPath('a')).toBe('sftp://a/y');
    expect(r.lastPath('b')).toBe('');
  });
  it('最近は上限件数まで', () => {
    const r = createRemotes();
    for (let i = 0; i < MAX_RECENT + 3; i++) r.touch(`h${i}`);
    expect(r.recent()).toHaveLength(MAX_RECENT);
    expect(r.recent()[0]).toBe(`h${MAX_RECENT + 2}`);
  });
  it('不正な接続先は記録しない', () => {
    const r = createRemotes();
    r.touch('-oX');
    r.touch('a b');
    expect(r.recent()).toEqual([]);
  });
  it('forget で最近と最後の場所を消す', () => {
    const r = createRemotes({ recent: ['a', 'b'], lastPath: { a: 'sftp://a/x' } });
    r.forget('a');
    expect(r.recent()).toEqual(['b']);
    expect(r.lastPath('a')).toBe('');
  });
  it('書き込み許可は既定 false。保存対象に含めない', () => {
    const r = createRemotes();
    expect(r.isWritable('a')).toBe(false);
    r.setWritable('a', true);
    expect(r.isWritable('a')).toBe(true);
    expect(JSON.stringify(r.toJSON())).not.toContain('writable');
    r.setWritable('a', false);
    expect(r.isWritable('a')).toBe(false);
  });
  it('変更を購読者へ通知し、解除できる', () => {
    const r = createRemotes();
    const fn = vi.fn();
    const off = r.subscribe(fn);
    r.touch('a');
    r.setWritable('a', true);
    off();
    r.touch('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('壊れた保存値を捨てる', () => {
    const r = createRemotes({
      recent: ['ok', 3, '-bad', 'ok'],
      lastPath: { ok: 1, x: 'sftp://x/' },
    });
    expect(r.recent()).toEqual(['ok']);
    expect(r.lastPath('ok')).toBe('');
    expect(r.lastPath('x')).toBe('sftp://x/');
    expect(createRemotes({ recent: 'nope', lastPath: null }).recent()).toEqual([]);
  });
});

describe('hostCandidates', () => {
  it('最近 → 接続中 → ssh config の順で重複を除く', () => {
    expect(
      hostCandidates({ recent: ['b'], connected: ['a', 'b'], configured: ['c', 'a', '*.x'] }),
    ).toEqual([
      { host: 'b', source: 'recent' },
      { host: 'a', source: 'connected' },
      { host: 'c', source: 'config' },
    ]);
    expect(hostCandidates()).toEqual([]);
  });
});

describe('targetUri', () => {
  it('空・~ はホーム', () => {
    expect(targetUri('k16', '')).toBe('sftp://k16');
    expect(targetUri(' k16 ', ' ~ ')).toBe('sftp://k16');
  });
  it('~/x と相対はホーム基準、絶対はそのまま', () => {
    expect(targetUri('k16', '~/notes')).toBe('sftp://k16/~/notes');
    expect(targetUri('k16', 'notes')).toBe('sftp://k16/~/notes');
    expect(targetUri('k16', '/etc')).toBe('sftp://k16/etc');
  });
  it('接続先が不正なら null', () => {
    expect(targetUri('', '/x')).toBeNull();
    expect(targetUri('-oX', '/x')).toBeNull();
  });
});

describe('load/store', () => {
  function memStorage() {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  }
  it('往復できる', () => {
    const s = memStorage();
    storeRemotes({ recent: ['a'], lastPath: {} }, s);
    expect(loadStoredRemotes(s)).toEqual({ recent: ['a'], lastPath: {} });
  });
  it('壊れた JSON・例外は空に倒す', () => {
    const s = memStorage();
    s.setItem(STORAGE_KEY, '{');
    expect(loadStoredRemotes(s)).toEqual({});
    const bad = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(loadStoredRemotes(bad)).toEqual({});
    expect(() => storeRemotes({}, bad)).not.toThrow();
  });
});
