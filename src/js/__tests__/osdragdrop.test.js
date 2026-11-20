import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOsDropTarget, createDragOut, describeOsDropRefusal } from '../core/osdragdrop.js';

const DIRS = { left: '/base', right: '/other' };

let root;
let hit;
let realElementFromPoint;

function buildDom() {
  const el = document.createElement('div');
  el.innerHTML = `
    <section class="pane" data-pane="left">
      <ul class="pane-list">
        <li class="entry is-dir" data-path="/base/docs">docs</li>
        <li class="entry" data-path="/base/a.txt">a.txt</li>
      </ul>
    </section>
    <section class="pane" data-pane="right">
      <ul class="pane-list"></ul>
    </section>`;
  document.body.appendChild(el);
  return el;
}
const q = (sel) => root.querySelector(sel);

beforeEach(() => {
  root = buildDom();
  hit = null;
  realElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = vi.fn(() => hit);
});
afterEach(() => {
  root.remove();
  document.elementFromPoint = realElementFromPoint;
});

// ===== 外 → Tana =====
describe('createOsDropTarget — 外からのドロップ', () => {
  let onDrop;
  let toast;
  let canMutate;
  let pathKinds;
  let outbound;
  let target;

  beforeEach(() => {
    onDrop = vi.fn();
    toast = vi.fn();
    canMutate = true;
    outbound = null;
    pathKinds = vi.fn(async (paths) =>
      paths.map((p) => ({
        path: p,
        name: p.split('/').pop(),
        is_dir: p.endsWith('dir'),
        exists: !p.includes('gone'),
      })),
    );
    target = createOsDropTarget({
      getPaneDir: (p) => DIRS[p],
      canMutate: () => canMutate,
      pathKinds,
      onDrop,
      toast,
      getScale: () => 2,
      getOutbound: () => outbound,
    });
  });

  it('相手ペインの余白に落とすと、そのペインの現在地へコピーする', async () => {
    hit = q('.pane[data-pane="right"] .pane-list');
    await target.handle({ type: 'drop', paths: ['/ext/x.txt'], position: { x: 40, y: 60 } });
    expect(onDrop).toHaveBeenCalledWith({
      sources: [{ path: '/ext/x.txt', name: 'x.txt', is_dir: false }],
      destDir: '/other',
      effect: 'copy',
    });
  });

  it('座標は倍率で割ってから当たり判定する（高DPI）', async () => {
    hit = q('.pane[data-pane="right"] .pane-list');
    await target.handle({ type: 'drop', paths: ['/ext/x.txt'], position: { x: 40, y: 60 } });
    expect(document.elementFromPoint).toHaveBeenCalledWith(20, 30);
  });

  it('フォルダ行に落とすとそのフォルダへ', async () => {
    hit = q('.entry.is-dir');
    await target.handle({ type: 'drop', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
    expect(onDrop.mock.calls[0][0].destDir).toBe('/base/docs');
  });

  it('消えたものは除き、全部消えていれば何もしない', async () => {
    hit = q('.pane[data-pane="right"] .pane-list');
    await target.handle({ type: 'drop', paths: ['/ext/gone'], position: { x: 0, y: 0 } });
    expect(onDrop).not.toHaveBeenCalled();
    await target.handle({
      type: 'drop',
      paths: ['/ext/gone', '/ext/y.txt'],
      position: { x: 0, y: 0 },
    });
    expect(onDrop.mock.calls[0][0].sources.map((s) => s.path)).toEqual(['/ext/y.txt']);
  });

  it('ペインの外に落としたら何もしない', async () => {
    hit = document.body;
    await target.handle({ type: 'drop', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
    expect(onDrop).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('安全モードでは受けず、理由を伝える', async () => {
    canMutate = false;
    hit = q('.pane[data-pane="right"] .pane-list');
    await target.handle({ type: 'drop', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
    expect(onDrop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('安全モード'));
    expect(pathKinds).not.toHaveBeenCalled();
  });

  it('フォルダを自分の中へ落とすのは弾く（無限再帰の防止）', async () => {
    hit = q('.entry.is-dir'); // /base/docs
    await target.handle({ type: 'drop', paths: ['/base/dir'], position: { x: 0, y: 0 } });
    // /base/dir → /base/docs は子孫ではないので通る
    expect(onDrop).toHaveBeenCalledTimes(1);
    onDrop.mockClear();
    pathKinds.mockImplementation(async (paths) =>
      paths.map((p) => ({ path: p, name: 'base', is_dir: true, exists: true })),
    );
    await target.handle({ type: 'drop', paths: ['/base'], position: { x: 0, y: 0 } });
    expect(onDrop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(describeOsDropRefusal('into-descendant'));
  });

  it('drop に paths が無ければ enter で受けたものを使う', async () => {
    hit = q('.pane[data-pane="right"] .pane-list');
    await target.handle({ type: 'enter', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
    await target.handle({ type: 'drop', position: { x: 0, y: 0 } });
    expect(onDrop.mock.calls[0][0].sources[0].path).toBe('/ext/x.txt');
  });

  it('直前に外へ出したものが戻ってきたら、元の場所（リモート）に読み替える', async () => {
    outbound = {
      paths: ['/tmp/cache/h/b.txt'],
      sources: [{ path: 'sftp://h/b.txt', name: 'b.txt', is_dir: false }],
    };
    hit = q('.pane[data-pane="right"] .pane-list');
    await target.handle({ type: 'drop', paths: ['/tmp/cache/h/b.txt'], position: { x: 0, y: 0 } });
    expect(pathKinds).not.toHaveBeenCalled();
    expect(onDrop.mock.calls[0][0].sources[0].path).toBe('sftp://h/b.txt');
  });

  it('種類の問い合わせに失敗したら理由を伝える', async () => {
    pathKinds.mockRejectedValue(new Error('boom'));
    hit = q('.pane[data-pane="right"] .pane-list');
    await target.handle({ type: 'drop', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
    expect(onDrop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  describe('ドロップ先の強調', () => {
    it('over でフォルダ行は drop-into、余白はペインに drop-here', async () => {
      await target.handle({ type: 'enter', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
      hit = q('.entry.is-dir');
      await target.handle({ type: 'over', position: { x: 0, y: 0 } });
      expect(q('.entry.is-dir').classList.contains('drop-into')).toBe(true);
      hit = q('.pane[data-pane="right"] .pane-list');
      await target.handle({ type: 'over', position: { x: 0, y: 0 } });
      expect(q('.entry.is-dir').classList.contains('drop-into')).toBe(false);
      expect(q('.pane[data-pane="right"]').classList.contains('drop-here')).toBe(true);
    });

    it('leave と drop で強調を消す', async () => {
      hit = q('.pane[data-pane="right"] .pane-list');
      await target.handle({ type: 'enter', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
      expect(q('.pane[data-pane="right"]').classList.contains('drop-here')).toBe(true);
      await target.handle({ type: 'leave' });
      expect(root.querySelector('.drop-here, .drop-into')).toBeNull();
      await target.handle({ type: 'enter', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
      await target.handle({ type: 'drop', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
      expect(root.querySelector('.drop-here, .drop-into')).toBeNull();
    });

    it('安全モード中・自分自身の上では光らせない', async () => {
      canMutate = false;
      hit = q('.pane[data-pane="right"] .pane-list');
      await target.handle({ type: 'enter', paths: ['/ext/x.txt'], position: { x: 0, y: 0 } });
      expect(root.querySelector('.drop-here')).toBeNull();
      canMutate = true;
      hit = q('.entry.is-dir');
      await target.handle({ type: 'enter', paths: ['/base/docs'], position: { x: 0, y: 0 } });
      expect(root.querySelector('.drop-into')).toBeNull();
    });
  });
});

// ===== Tana → 外 =====
describe('createDragOut — 外へのドラッグ', () => {
  let startDrag;
  let fetchRemote;
  let toast;
  let out;

  beforeEach(() => {
    startDrag = vi.fn(async () => {});
    fetchRemote = vi.fn(async (p) => p.replace('sftp://h', '/tmp/cache/h'));
    toast = vi.fn();
    out = createDragOut({
      startDrag,
      fetchRemote,
      isRemote: (p) => p.startsWith('sftp://'),
      makeIcon: () => 'data:image/png;base64,AAAA',
      toast,
    });
  });

  it('ローカルはそのままのパスで OS のドラッグを始める', async () => {
    const ok = await out.start([
      { path: '/l/a.txt', name: 'a.txt', is_dir: false },
      { path: '/l/dir', name: 'dir', is_dir: true },
    ]);
    expect(ok).toBe(true);
    expect(startDrag).toHaveBeenCalledWith(['/l/a.txt', '/l/dir'], 'data:image/png;base64,AAAA');
    expect(fetchRemote).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('リモートのファイルは取り寄せてから、手元のパスで渡す', async () => {
    const sources = [
      { path: 'sftp://h/r/b.txt', name: 'b.txt', is_dir: false },
      { path: '/l/a.txt', name: 'a.txt', is_dir: false },
    ];
    await out.start(sources);
    expect(fetchRemote).toHaveBeenCalledWith('sftp://h/r/b.txt');
    expect(startDrag.mock.calls[0][0]).toEqual(['/tmp/cache/h/r/b.txt', '/l/a.txt']);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('取り寄せ'));
    expect(out.getOutbound()).toEqual({
      paths: ['/tmp/cache/h/r/b.txt', '/l/a.txt'],
      sources,
    });
  });

  it('リモートのフォルダは断る', async () => {
    const ok = await out.start([{ path: 'sftp://h/r/d', name: 'd', is_dir: true }]);
    expect(ok).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('リモートのフォルダ'));
  });

  it('取り寄せ中に離されたら始めない（離した位置に勝手に落ちるため）', async () => {
    const ok = await out.start([{ path: 'sftp://h/r/b.txt', name: 'b.txt' }], () => false);
    expect(ok).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
  });

  it('ローカルだけなら待ちが無いので stillHeld を見ない', async () => {
    const ok = await out.start([{ path: '/l/a.txt', name: 'a.txt' }], () => false);
    expect(ok).toBe(true);
  });

  it('stillHeld は非同期（OS に尋ねる）でもよい。離されていたら始めない', async () => {
    const ok = await out.start([{ path: 'sftp://h/r/b.txt', name: 'b.txt' }], async () => false);
    expect(ok).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('離された'));
    expect(await out.start([{ path: 'sftp://h/r/b.txt', name: 'b.txt' }], async () => true)).toBe(
      true,
    );
  });

  it('OS に渡す直前に点検し、置き直したパスで始める', async () => {
    const preparePaths = vi.fn(async (paths) =>
      paths.map((p) => p.replace('/tmp/cache/h/r', '/s')),
    );
    const o = createDragOut({
      startDrag,
      fetchRemote,
      isRemote: (p) => p.startsWith('sftp://'),
      makeIcon: () => 'icon',
      toast,
      preparePaths,
    });
    const sources = [{ path: 'sftp://h/r/b.txt', name: 'b.txt' }];
    expect(await o.start(sources)).toBe(true);
    expect(preparePaths).toHaveBeenCalledWith(['/tmp/cache/h/r/b.txt']);
    expect(startDrag).toHaveBeenCalledWith(['/s/b.txt'], 'icon');
    // 戻して落としたときの読み替えも、実際に OS へ渡したパスで行う
    expect(o.getOutbound()).toEqual({ paths: ['/s/b.txt'], sources });
  });

  it('WSL 上の手元のファイルがコピーされたら、待った分ボタンを確かめる', async () => {
    const preparePaths = vi.fn(async (paths) =>
      paths.map((p) => (p.startsWith('//wsl') ? '/tmp/tana-drag/1/a.md' : p)),
    );
    const o = createDragOut({
      startDrag,
      fetchRemote,
      isRemote: () => false,
      makeIcon: () => 'icon',
      toast,
      preparePaths,
    });
    const src = [{ path: '//wsl/u/a.md', name: 'a.md' }];
    // 離されていたら始めない
    expect(await o.start(src, async () => false)).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
    // 押したままならコピー先で始める
    expect(await o.start(src, async () => true)).toBe(true);
    expect(startDrag).toHaveBeenCalledWith(['/tmp/tana-drag/1/a.md'], 'icon');
    expect(o.getOutbound().paths).toEqual(['/tmp/tana-drag/1/a.md']);
  });

  it('コピーしなかった手元のファイルは待ちが無いので stillHeld を見ない', async () => {
    const o = createDragOut({
      startDrag,
      fetchRemote,
      isRemote: () => false,
      makeIcon: () => 'icon',
      toast,
      preparePaths: async (paths) => paths,
    });
    const stillHeld = vi.fn(async () => false);
    expect(await o.start([{ path: '/l/a.txt', name: 'a.txt' }], stillHeld)).toBe(true);
    expect(stillHeld).not.toHaveBeenCalled();
  });

  it('点検で断られたら OS のドラッグを始めず理由を伝える（落ちる代わりに）', async () => {
    const o = createDragOut({
      startDrag,
      fetchRemote,
      isRemote: () => false,
      makeIcon: () => 'icon',
      toast,
      preparePaths: async () => {
        throw 'パスが長すぎるか、Windows で扱えない名前のため外へ渡せません: a.txt';
      },
    });
    expect(await o.start([{ path: '/l/a.txt', name: 'a.txt' }])).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('パスが長すぎる'));
    expect(o.getOutbound()).toBeNull();
  });

  it('取り寄せや開始の失敗は理由を伝える', async () => {
    fetchRemote.mockRejectedValue(new Error('接続できません'));
    expect(await out.start([{ path: 'sftp://h/r/b.txt', name: 'b.txt' }])).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('接続できません'));
    startDrag.mockRejectedValue(new Error('no window'));
    expect(await out.start([{ path: '/l/a.txt', name: 'a.txt' }])).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('no window'));
  });
});

describe('戻ってきたドラッグの文字選択を消す', () => {
  it('drop / leave で選択を解除する', async () => {
    const t = createOsDropTarget({
      getPaneDir: (p) => DIRS[p],
      canMutate: () => true,
      pathKinds: async () => [],
      onDrop: vi.fn(),
      toast: vi.fn(),
    });
    const range = document.createRange();
    range.selectNodeContents(q('.entry.is-dir'));
    document.getSelection().addRange(range);
    expect(document.getSelection().rangeCount).toBe(1);
    await t.handle({ type: 'leave' });
    expect(document.getSelection().rangeCount).toBe(0);
    document.getSelection().addRange(range);
    await t.handle({ type: 'drop', paths: [], position: { x: 0, y: 0 } });
    expect(document.getSelection().rangeCount).toBe(0);
  });
});
