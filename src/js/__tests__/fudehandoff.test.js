import { describe, it, expect } from 'vitest';
import { fudeHandoffUri, isFudeApp, isMarkdownName } from '../core/fudehandoff.js';

// 回帰: リモートの .md を Fude で開くと一時コピーを編集することになり、保存しても
// ホストへ戻らなかった。Fude で開く場面では ssh://host/path を渡す。
describe('fudeHandoffUri', () => {
  it('既定のアプリで開くリモートの Markdown は Fude へ', () => {
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://k16/home/u/a.md' })).toBe(
      'ssh://k16/home/u/a.md',
    );
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://u@k16/x/b.QMD' })).toBe(
      'ssh://u@k16/x/b.QMD',
    );
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://k16/a b/c.markdown' })).toBe(
      'ssh://k16/a b/c.markdown',
    );
  });

  it('Markdown 以外は既定のアプリ（従来の一時コピー）のまま', () => {
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://k16/a.png' })).toBeNull();
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://k16/a.pdf' })).toBeNull();
  });

  it('Fude を指定して開くなら Markdown 以外でも渡す', () => {
    const spec = { name: 'Fude', command: 'fude' };
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://k16/etc/hosts', spec })).toBe(
      'ssh://k16/etc/hosts',
    );
  });

  it('Fude 以外のアプリを指定したら渡さない', () => {
    const spec = { name: 'メモ帳', command: 'notepad.exe' };
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://k16/a.md', spec })).toBeNull();
  });

  it('ローカル・表示（reveal）・場所の無いものは対象外', () => {
    expect(fudeHandoffUri({ kind: 'open', path: '/home/u/a.md' })).toBeNull();
    expect(fudeHandoffUri({ kind: 'open', path: 'C:\\u\\a.md' })).toBeNull();
    expect(fudeHandoffUri({ kind: 'reveal', path: 'sftp://k16/a.md' })).toBeNull();
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://k16' })).toBeNull();
    expect(fudeHandoffUri({ kind: 'open', path: 'sftp://-oProxy/a.md' })).toBeNull();
  });
});

describe('isFudeApp', () => {
  it('コマンドの末尾か表示名で見分ける', () => {
    expect(isFudeApp({ command: 'fude' })).toBe(true);
    expect(isFudeApp({ command: 'C:\\Users\\u\\AppData\\Local\\Fude\\Fude.exe' })).toBe(true);
    expect(isFudeApp({ command: '/Applications/Fude.app' })).toBe(true);
    expect(isFudeApp({ command: 'Fude' })).toBe(true);
    expect(isFudeApp({ name: 'fude', command: '/opt/x/run' })).toBe(true);
  });

  it('似た名前・別のアプリは違う', () => {
    expect(isFudeApp({ command: 'fude-cli' })).toBe(false);
    expect(isFudeApp({ command: 'notfude' })).toBe(false);
    expect(isFudeApp({ command: 'code' })).toBe(false);
    expect(isFudeApp(null)).toBe(false);
  });
});

describe('isMarkdownName', () => {
  it('Markdown の拡張子だけ', () => {
    for (const n of ['a.md', 'A.MD', 'b.markdown', 'c.mdown', 'd.mkd', 'e.qmd', 'f.mdx']) {
      expect(isMarkdownName(n)).toBe(true);
    }
    for (const n of ['a.txt', 'md', 'a.md.bak', null]) expect(isMarkdownName(n)).toBe(false);
  });
});
