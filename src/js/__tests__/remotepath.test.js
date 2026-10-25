import { describe, it, expect } from 'vitest';
import {
  isValidHost,
  isRemote,
  parseRemote,
  formatRemote,
  remoteHost,
  normalizeRemote,
  needsResolve,
  remoteParent,
  remoteSegments,
  remoteLabel,
  describeRemoteError,
  readOnlyHostAmong,
} from '../core/remotepath.js';

describe('isValidHost', () => {
  it('ssh の接続先として普通の綴りを通す', () => {
    for (const h of ['k16', 'me@k16', 'host.example.com', '[::1]', 'a-b_c']) {
      expect(isValidHost(h)).toBe(true);
    }
  });
  it('オプション注入・空白・区切り・空を拒む', () => {
    for (const h of ['', '-oProxyCommand=x', 'a b', 'a/b', 'a;b', null, 'x'.repeat(256)]) {
      expect(isValidHost(h)).toBe(false);
    }
  });
});

describe('parseRemote / formatRemote', () => {
  it('接続先とパスに分ける', () => {
    expect(parseRemote('sftp://k16/home/u')).toEqual({ host: 'k16', path: '/home/u' });
    expect(parseRemote('sftp://k16')).toEqual({ host: 'k16', path: '' });
    expect(parseRemote('sftp://k16/')).toEqual({ host: 'k16', path: '/' });
  });
  it('リモートでない・接続先が不正なら null', () => {
    expect(parseRemote('/home/u')).toBeNull();
    expect(parseRemote('C:/x')).toBeNull();
    expect(parseRemote('sftp:///x')).toBeNull();
    expect(parseRemote('sftp://-oX/')).toBeNull();
    expect(parseRemote(undefined)).toBeNull();
  });
  it('組み立ては相対パスに / を補う', () => {
    expect(formatRemote('k16', '/a')).toBe('sftp://k16/a');
    expect(formatRemote('k16', 'a')).toBe('sftp://k16/a');
    expect(formatRemote('k16')).toBe('sftp://k16');
  });
  it('isRemote / remoteHost', () => {
    expect(isRemote('sftp://k16/a')).toBe(true);
    expect(isRemote('/sftp://')).toBe(false);
    expect(remoteHost('sftp://me@k16/a')).toBe('me@k16');
    expect(remoteHost('/a')).toBeNull();
  });
});

describe('normalizeRemote / needsResolve', () => {
  it('. と .. と重複区切りを解決し、ルートより上には登らない', () => {
    expect(normalizeRemote('sftp://k16/a//b/./c/../d/')).toBe('sftp://k16/a/b/d');
    expect(normalizeRemote('sftp://k16/../..')).toBe('sftp://k16/');
  });
  it('~ はホーム基準のまま残す（接続後に解決）', () => {
    expect(normalizeRemote('sftp://k16/~/')).toBe('sftp://k16/~');
    expect(normalizeRemote('sftp://k16/~/x')).toBe('sftp://k16/~/x');
    expect(normalizeRemote('sftp://k16')).toBe('sftp://k16');
    expect(normalizeRemote('/x')).toBeNull();
  });
  it('ホームや ~ を含むものだけ解決が要る', () => {
    expect(needsResolve('sftp://k16')).toBe(true);
    expect(needsResolve('sftp://k16/~')).toBe(true);
    expect(needsResolve('sftp://k16/~/a')).toBe(true);
    expect(needsResolve('sftp://k16/home/~x')).toBe(false);
    expect(needsResolve('/home')).toBe(false);
  });
});

describe('remoteParent', () => {
  it('一つ上へ。相手のルートの上は無い', () => {
    expect(remoteParent('sftp://k16/a/b')).toBe('sftp://k16/a');
    expect(remoteParent('sftp://k16/a/')).toBe('sftp://k16/');
    expect(remoteParent('sftp://k16/')).toBeNull();
    expect(remoteParent('sftp://k16')).toBeNull();
    expect(remoteParent('/a')).toBeNull();
  });
});

describe('remoteSegments', () => {
  it('先頭は接続先、以降は階層ごとの URI', () => {
    expect(remoteSegments('sftp://k16/home/u')).toEqual([
      { name: 'k16:', path: 'sftp://k16/' },
      { name: 'home', path: 'sftp://k16/home' },
      { name: 'u', path: 'sftp://k16/home/u' },
    ]);
    expect(remoteSegments('sftp://k16/')).toEqual([{ name: 'k16:', path: 'sftp://k16/' }]);
    expect(remoteSegments('/x')).toEqual([]);
  });
});

describe('remoteLabel', () => {
  it('host:path の短い表記', () => {
    expect(remoteLabel('sftp://k16/home/u')).toBe('k16:/home/u');
    expect(remoteLabel('sftp://k16')).toBe('k16:~');
    expect(remoteLabel('/local')).toBe('/local');
  });
});

describe('describeRemoteError', () => {
  it('READ_ONLY を案内に言い換える', () => {
    expect(describeRemoteError('READ_ONLY:k16')).toContain('k16 は閲覧のみ');
    expect(describeRemoteError({ message: 'READ_ONLY:k16' })).toContain('o → s');
  });
  it('それ以外はそのまま', () => {
    expect(describeRemoteError('EXISTS')).toBe('EXISTS');
    expect(describeRemoteError(null)).toBe('');
  });
});

describe('readOnlyHostAmong', () => {
  const writable = new Set(['w']);
  const isW = (h) => writable.has(h);
  it('許可されていないリモートの接続先を返す', () => {
    expect(readOnlyHostAmong(['/local', 'sftp://w/a', 'sftp://r/b'], isW)).toBe('r');
  });
  it('ローカルと許可済みだけなら null', () => {
    expect(readOnlyHostAmong(['/local', 'sftp://w/a', null, undefined], isW)).toBeNull();
    expect(readOnlyHostAmong([], isW)).toBeNull();
  });
});
