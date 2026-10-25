import { describe, it, expect } from 'vitest';
import {
  resolveInputPath,
  resolveStartDir,
  pathSegments,
  normalizePath,
  normalizeSeparators,
  describeOpenError,
  parentPath,
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

describe('resolveStartDir', () => {
  const ctx = { home: '/home/u', cwd: '/home/u/docs' };

  // 再発防止: `tana .` で起動するとエントリのパスまで相対（./reports/x.md）になり、
  // Windows 側で開く経路が「絶対パスではありません」で失敗していた。
  it('CLI の相対パスを cwd から解決する', () => {
    expect(resolveStartDir('.', ctx)).toBe('/home/u/docs');
    expect(resolveStartDir('./reports', ctx)).toBe('/home/u/docs/reports');
    expect(resolveStartDir('reports/2026', ctx)).toBe('/home/u/docs/reports/2026');
    expect(resolveStartDir('..', ctx)).toBe('/home/u');
  });

  it('~ をホームに展開する', () => {
    expect(resolveStartDir('~/work', ctx)).toBe('/home/u/work');
  });

  // list_dir はネイティブ区切りで返すので、絶対パスの綴りは変えない
  it('絶対パスは綴りを変えずそのまま返す', () => {
    expect(resolveStartDir('/etc/nginx', ctx)).toBe('/etc/nginx');
    expect(resolveStartDir('C:\\Users\\me', ctx)).toBe('C:\\Users\\me');
    expect(resolveStartDir('\\\\wsl.localhost\\Ubuntu\\home', ctx)).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home',
    );
    expect(resolveStartDir('  /etc  ', ctx)).toBe('/etc');
  });

  it('空・非文字列・cwd 不明の相対パスは null', () => {
    expect(resolveStartDir('', ctx)).toBeNull();
    expect(resolveStartDir('   ', ctx)).toBeNull();
    expect(resolveStartDir(null, ctx)).toBeNull();
    expect(resolveStartDir(undefined, ctx)).toBeNull();
    expect(resolveStartDir('sub', { home: '/home/u' })).toBeNull();
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

describe('UNC パス（WSL の \\\\wsl$ 等）', () => {
  it('normalizeSeparators は先頭 // を保持する', () => {
    expect(normalizeSeparators('\\\\wsl$\\Ubuntu\\home')).toBe('//wsl$/Ubuntu/home');
    expect(normalizeSeparators('//wsl$//Ubuntu/')).toBe('//wsl$/Ubuntu');
    expect(normalizeSeparators('//wsl$')).toBe('//wsl$');
  });
  it('normalizePath は UNC ルートを保ちつつ .. を解決', () => {
    expect(normalizePath('//wsl$/Ubuntu/../home')).toBe('//wsl$/home');
    expect(normalizePath('\\\\wsl$\\Ubuntu\\.\\x')).toBe('//wsl$/Ubuntu/x');
  });
  it('pathSegments は \\\\host を先頭に段階を作る', () => {
    expect(pathSegments('//wsl$/Ubuntu/home')).toEqual([
      { name: '\\\\wsl$', path: '//wsl$' },
      { name: 'Ubuntu', path: '//wsl$/Ubuntu' },
      { name: 'home', path: '//wsl$/Ubuntu/home' },
    ]);
  });
  it('parentPath は UNC を辿り、ホストで止まる', () => {
    expect(parentPath('//wsl$/Ubuntu/home')).toBe('//wsl$/Ubuntu');
    expect(parentPath('//wsl$/Ubuntu')).toBe('//wsl$');
    expect(parentPath('//wsl$')).toBeNull();
  });
});

describe('parentPath', () => {
  it('通常の親を返す', () => {
    expect(parentPath('/a/b/c')).toBe('/a/b');
    expect(parentPath('C:/a/b')).toBe('C:/a');
    expect(parentPath('C:\\a\\b.txt')).toBe('C:/a');
  });
  it('ルート直下は "/" / "C:/"', () => {
    expect(parentPath('/a')).toBe('/');
    expect(parentPath('C:/a')).toBe('C:/');
  });
  it('ルート自身は親なし(null)', () => {
    expect(parentPath('/')).toBeNull();
    expect(parentPath('C:/')).toBeNull();
    expect(parentPath('')).toBeNull();
  });
  it('末尾スラッシュを無視する', () => {
    expect(parentPath('/a/b/')).toBe('/a');
  });
});

describe('describeOpenError', () => {
  // Rust list_dir は "<path>: <理由> (os error N)" 形式でエラーを返す
  it('存在しないドライブルートは「ドライブ X: を開けません」＋理由', () => {
    const msg = describeOpenError('L:/', 'L:/: 指定されたパスが見つかりません。 (os error 3)');
    expect(msg).toBe('ドライブ L: を開けません（指定されたパスが見つかりません。）');
  });

  it('ドライブレターは大文字化する', () => {
    expect(describeOpenError('l:/', 'l:/: not found (os error 3)')).toBe(
      'ドライブ L: を開けません（not found）',
    );
  });

  it('理由が取れないドライブルートは既定の補足を添える', () => {
    expect(describeOpenError('L:/', '')).toBe(
      'ドライブ L: を開けません（見つからないかアクセスできません）',
    );
  });

  it('通常パスはパスを示し、理由を括弧で添える', () => {
    const msg = describeOpenError(
      'C:/Users/x/gone',
      'C:/Users/x/gone: アクセスが拒否されました。 (os error 5)',
    );
    expect(msg).toBe('開けませんでした: C:/Users/x/gone（アクセスが拒否されました。）');
  });

  it('path.display() がバックスラッシュ綴りでも先頭パスを剥がす', () => {
    const msg = describeOpenError('L:/', 'L:\\: 指定されたパスが見つかりません。 (os error 3)');
    expect(msg).toBe('ドライブ L: を開けません（指定されたパスが見つかりません。）');
  });

  it('error が {message} でも理由を取り出す', () => {
    const msg = describeOpenError('/x', { message: '/x: No such file or directory (os error 2)' });
    expect(msg).toBe('開けませんでした: /x（No such file or directory）');
  });

  it('理由が空なら通常パスは素の文言', () => {
    expect(describeOpenError('/x', null)).toBe('開けませんでした: /x');
  });

  it('先頭パスに一致しない理由はそのまま添える', () => {
    expect(describeOpenError('/x', 'something went wrong')).toBe(
      '開けませんでした: /x（something went wrong）',
    );
  });
});

describe('リモートの場所 sftp://（FR-20）', () => {
  it('resolveInputPath: sftp:// はそのまま整える（~ は残す）', () => {
    expect(resolveInputPath(' sftp://k16/a/../b ')).toBe('sftp://k16/b');
    expect(resolveInputPath('sftp://k16')).toBe('sftp://k16');
    expect(resolveInputPath('"sftp://k16/~/x"')).toBe('sftp://k16/~/x');
    expect(resolveInputPath('sftp://-oX/')).toBeNull();
  });
  it('resolveInputPath: リモートにいるときの相対入力はその場所基準', () => {
    const ctx = { home: '/home/me', cwd: 'sftp://k16/srv/app' };
    expect(resolveInputPath('logs', ctx)).toBe('sftp://k16/srv/app/logs');
    expect(resolveInputPath('../etc', ctx)).toBe('sftp://k16/srv/etc');
    // ~ と絶対パスは手元
    expect(resolveInputPath('~', ctx)).toBe('/home/me');
    expect(resolveInputPath('/tmp', ctx)).toBe('/tmp');
  });
  it('resolveStartDir: セッションに残ったリモートはそのまま', () => {
    expect(resolveStartDir('sftp://k16/home/u', { cwd: '/x' })).toBe('sftp://k16/home/u');
  });
  it('parentPath / pathSegments はリモートの規則で', () => {
    expect(parentPath('sftp://k16/a/b')).toBe('sftp://k16/a');
    expect(parentPath('sftp://k16/')).toBeNull();
    expect(pathSegments('sftp://k16/a').map((s) => s.name)).toEqual(['k16:', 'a']);
  });
  it('describeOpenError: host:path で示し、Rust の「uri: 理由」から理由を取り出す', () => {
    expect(describeOpenError('sftp://k16/x', 'sftp://k16/x: 見つかりません')).toBe(
      '開けませんでした: k16:/x（見つかりません）',
    );
  });
});
