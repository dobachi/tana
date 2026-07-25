import { describe, it, expect } from 'vitest';
import {
  parentDirOf,
  isSameOrDescendant,
  dragPayload,
  dropEffect,
  validateDrop,
  exceededThreshold,
  describeDrag,
} from '../core/dnd.js';

const dir = (name, path) => ({ name, path, is_dir: true });
const file = (name, path) => ({ name, path, is_dir: false });

const ENTRIES = [
  dir('docs', '/home/u/docs'),
  file('a.txt', '/home/u/a.txt'),
  file('b.txt', '/home/u/b.txt'),
  file('c.txt', '/home/u/c.txt'),
];

describe('parentDirOf', () => {
  it('通常のパスの親を返す', () => {
    expect(parentDirOf('/home/u/a.txt')).toBe('/home/u');
    expect(parentDirOf('/home/u')).toBe('/home');
  });

  it('直下は根を返す', () => {
    expect(parentDirOf('/home')).toBe('/');
  });

  it('根より上には登らない', () => {
    expect(parentDirOf('/')).toBe('/');
  });

  it('Windows のドライブ直下はドライブ根を返す', () => {
    expect(parentDirOf('C:/a')).toBe('C:/');
    expect(parentDirOf('C:\\a')).toBe('C:/');
    expect(parentDirOf('C:/a/b')).toBe('C:/a');
    expect(parentDirOf('C:/')).toBe('C:/');
  });

  it('空入力は空を返す', () => {
    expect(parentDirOf('')).toBe('');
    expect(parentDirOf(null)).toBe('');
  });
});

describe('isSameOrDescendant', () => {
  it('同じパスは真', () => {
    expect(isSameOrDescendant('/a/b', '/a/b')).toBe(true);
  });

  it('子孫は真', () => {
    expect(isSameOrDescendant('/a', '/a/b')).toBe(true);
    expect(isSameOrDescendant('/a', '/a/b/c')).toBe(true);
  });

  it('前方一致するだけの別ディレクトリは偽（/foo と /foobar）', () => {
    expect(isSameOrDescendant('/foo', '/foobar')).toBe(false);
    expect(isSameOrDescendant('/foo', '/foobar/baz')).toBe(false);
  });

  it('祖先方向は偽', () => {
    expect(isSameOrDescendant('/a/b', '/a')).toBe(false);
  });

  it('根はすべての祖先', () => {
    expect(isSameOrDescendant('/', '/a')).toBe(true);
  });

  it('区切りが混在していても判定できる', () => {
    expect(isSameOrDescendant('C:\\a', 'C:/a/b')).toBe(true);
    expect(isSameOrDescendant('C:/a', 'C:\\a\\b')).toBe(true);
    expect(isSameOrDescendant('C:\\foo', 'C:/foobar')).toBe(false);
  });

  it('空入力は偽', () => {
    expect(isSameOrDescendant('', '/a')).toBe(false);
    expect(isSameOrDescendant('/a', '')).toBe(false);
  });
});

describe('dragPayload', () => {
  it('選択に含まれる行を掴んだら選択全体を対象にする', () => {
    const selected = new Set(['/home/u/a.txt', '/home/u/c.txt']);
    const r = dragPayload(ENTRIES, selected, '/home/u/a.txt');
    expect(r.map((e) => e.path)).toEqual(['/home/u/a.txt', '/home/u/c.txt']);
  });

  it('選択の表示順を保つ（掴んだ行が先頭に来たりしない）', () => {
    const selected = new Set(['/home/u/a.txt', '/home/u/c.txt']);
    const r = dragPayload(ENTRIES, selected, '/home/u/c.txt');
    expect(r.map((e) => e.path)).toEqual(['/home/u/a.txt', '/home/u/c.txt']);
  });

  it('選択の外の行を掴んだらその1件だけを対象にする', () => {
    const selected = new Set(['/home/u/a.txt', '/home/u/c.txt']);
    const r = dragPayload(ENTRIES, selected, '/home/u/b.txt');
    expect(r.map((e) => e.path)).toEqual(['/home/u/b.txt']);
  });

  it('選択が空ならその1件だけを対象にする', () => {
    const r = dragPayload(ENTRIES, new Set(), '/home/u/b.txt');
    expect(r.map((e) => e.path)).toEqual(['/home/u/b.txt']);
  });

  it('存在しないパスを掴んだら空', () => {
    expect(dragPayload(ENTRIES, new Set(), '/nope')).toEqual([]);
    expect(dragPayload(ENTRIES, new Set(), '')).toEqual([]);
  });
});

describe('dropEffect', () => {
  it('修飾なしはコピー（非破壊が既定）', () => {
    expect(dropEffect({}, true)).toBe('copy');
    expect(dropEffect(undefined, true)).toBe('copy');
  });

  it('Shift 押下は移動', () => {
    expect(dropEffect({ shift: true }, true)).toBe('move');
  });

  it('安全モードでは修飾によらず none', () => {
    expect(dropEffect({}, false)).toBe('none');
    expect(dropEffect({ shift: true }, false)).toBe('none');
  });
});

describe('validateDrop', () => {
  const files = [file('a.txt', '/home/u/a.txt')];

  it('別ディレクトリへのコピー/移動を許可する', () => {
    expect(validateDrop(files, '/tmp', 'copy')).toEqual({ ok: true, reason: null });
    expect(validateDrop(files, '/tmp', 'move')).toEqual({ ok: true, reason: null });
  });

  it('対象が空なら empty', () => {
    expect(validateDrop([], '/tmp', 'copy').reason).toBe('empty');
    expect(validateDrop(null, '/tmp', 'copy').reason).toBe('empty');
  });

  it('宛先が無ければ empty', () => {
    expect(validateDrop(files, '', 'copy').reason).toBe('empty');
  });

  it('効果が none なら denied（安全モード）', () => {
    expect(validateDrop(files, '/tmp', 'none').reason).toBe('denied');
  });

  it('フォルダを自分自身へは into-self', () => {
    const d = [dir('docs', '/home/u/docs')];
    expect(validateDrop(d, '/home/u/docs', 'copy').reason).toBe('into-self');
  });

  it('フォルダを自分の子孫へは into-descendant（無限再帰を防ぐ）', () => {
    const d = [dir('a', '/a')];
    expect(validateDrop(d, '/a/b/c', 'copy').reason).toBe('into-descendant');
    expect(validateDrop(d, '/a/b/c', 'move').reason).toBe('into-descendant');
  });

  it('前方一致するだけの別フォルダへは許可する（/foo → /foobar）', () => {
    const d = [dir('foo', '/foo')];
    expect(validateDrop(d, '/foobar', 'copy').ok).toBe(true);
  });

  it('ファイルは子孫判定の対象にしない', () => {
    // ファイル "/a" 配下という状況は無いので、パスが前方一致しても弾かない
    const f = [file('a', '/a')];
    expect(validateDrop(f, '/a/b', 'copy').ok).toBe(true);
  });

  it('移動で全件が既に宛先にあるなら same-dir', () => {
    expect(validateDrop(files, '/home/u', 'move').reason).toBe('same-dir');
  });

  it('移動でも一部が別の場所なら許可する', () => {
    const mixed = [file('a.txt', '/home/u/a.txt'), file('z.txt', '/other/z.txt')];
    expect(validateDrop(mixed, '/home/u', 'move').ok).toBe(true);
  });

  it('コピーは同じフォルダ内でも許可する（複製を作れる）', () => {
    expect(validateDrop(files, '/home/u', 'copy').ok).toBe(true);
  });

  it('区切りが混在していても同一ディレクトリと判定する', () => {
    const w = [file('a.txt', 'C:\\home\\a.txt')];
    expect(validateDrop(w, 'C:/home', 'move').reason).toBe('same-dir');
  });
});

describe('exceededThreshold', () => {
  it('既定 5px に届かなければ開始しない', () => {
    expect(exceededThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(exceededThreshold({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it('5px で開始する', () => {
    expect(exceededThreshold({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(exceededThreshold({ x: 0, y: 0 }, { x: 0, y: -5 })).toBe(true);
  });

  it('斜めの距離で判定する', () => {
    expect(exceededThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    expect(exceededThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
  });

  it('しきい値を指定できる', () => {
    expect(exceededThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }, 2)).toBe(true);
  });

  it('座標が無ければ偽', () => {
    expect(exceededThreshold(null, { x: 9, y: 9 })).toBe(false);
    expect(exceededThreshold({ x: 0, y: 0 }, null)).toBe(false);
  });
});

describe('describeDrag', () => {
  it('1件はファイル名と効果を出す', () => {
    expect(describeDrag([file('a.txt', '/a.txt')], 'copy')).toBe('「a.txt」をコピー');
    expect(describeDrag([file('a.txt', '/a.txt')], 'move')).toBe('「a.txt」を移動');
  });

  it('複数件は件数で出す', () => {
    expect(describeDrag(ENTRIES, 'copy')).toBe('4 件をコピー');
  });

  it('名前に「を」を含んでも切れ目が分かる', () => {
    expect(describeDrag([file('をわり.txt', '/をわり.txt')], 'move')).toBe('「をわり.txt」を移動');
  });

  it('効果が none なら対象だけを出す', () => {
    expect(describeDrag([file('a.txt', '/a.txt')], 'none')).toBe('「a.txt」');
  });

  it('対象が空なら空文字', () => {
    expect(describeDrag([], 'copy')).toBe('');
    expect(describeDrag(null, 'copy')).toBe('');
  });
});
