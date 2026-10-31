import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDragSession, resolveDropTarget } from '../core/dragdrop.js';

const ENTRIES = [
  { name: 'docs', path: '/base/docs', is_dir: true },
  { name: 'a.txt', path: '/base/a.txt', is_dir: false },
  { name: 'b.txt', path: '/base/b.txt', is_dir: false },
];

const DIRS = { left: '/base', right: '/other' };

let root;
let onDrop;
let session;
let canMutate;
let toast;
let hit; // elementFromPoint が返す要素
let realElementFromPoint;

function buildDom() {
  const el = document.createElement('div');
  el.innerHTML = `
    <section class="pane" data-pane="left">
      <header class="pane-header">
        <span class="pane-path"><button class="crumb" title="/base/up">up</button></span>
      </header>
      <ul class="pane-list">
        <li class="entry is-dir" data-path="/base/docs">docs</li>
        <li class="entry" data-path="/base/a.txt">a.txt</li>
        <li class="entry" data-path="/base/b.txt">b.txt</li>
      </ul>
    </section>
    <section class="pane" data-pane="right">
      <ul class="pane-list"></ul>
    </section>`;
  document.body.appendChild(el);
  return el;
}

const q = (sel) => root.querySelector(sel);
const ghost = () => document.querySelector('.drag-ghost');

const mouse = (type, x, y, init = {}) =>
  document.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init }),
  );
const key = (type, k, init = {}) =>
  document.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: k, ...init }));

/** 掴む → 動かす、までを行う。既定では相手ペインの余白の上にいる */
function beginDrag(path = '/base/a.txt', selected = new Set()) {
  session.begin({ entries: ENTRIES, selected, path, x: 0, y: 0 });
  hit = q('.pane[data-pane="right"] .pane-list');
  mouse('mousemove', 20, 20);
}

beforeEach(() => {
  root = buildDom();
  onDrop = vi.fn();
  toast = vi.fn();
  canMutate = true;
  hit = null;
  // jsdom はレイアウトを持たず elementFromPoint を実装していないので差し替える
  realElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => hit;
  session = createDragSession({
    getPaneDir: (pane) => DIRS[pane] || null,
    canMutate: () => canMutate,
    onDrop,
    toast,
  });
});

afterEach(() => {
  session.cancel();
  root.remove();
  document.elementFromPoint = realElementFromPoint;
});

describe('resolveDropTarget', () => {
  it('フォルダ行の上ならそのフォルダを宛先にする', () => {
    hit = q('.entry.is-dir');
    const t = resolveDropTarget(0, 0, (p) => DIRS[p]);
    expect(t).toMatchObject({ pane: 'left', destDir: '/base/docs', kind: 'entry' });
  });

  it('ファイル行の上ならそのペインの現在地を宛先にする', () => {
    hit = q('.entry[data-path="/base/a.txt"]');
    const t = resolveDropTarget(0, 0, (p) => DIRS[p]);
    expect(t).toMatchObject({ pane: 'left', destDir: '/base', kind: 'pane' });
  });

  it('一覧の余白ならそのペインの現在地を宛先にする', () => {
    hit = q('.pane[data-pane="right"] .pane-list');
    const t = resolveDropTarget(0, 0, (p) => DIRS[p]);
    expect(t).toMatchObject({ pane: 'right', destDir: '/other', kind: 'pane' });
  });

  it('ブレッドクラムの上ならその階層を宛先にする', () => {
    hit = q('.crumb');
    const t = resolveDropTarget(0, 0, (p) => DIRS[p]);
    expect(t).toMatchObject({ pane: 'left', destDir: '/base/up', kind: 'crumb' });
  });

  it('ペインの外なら null', () => {
    hit = document.body;
    expect(resolveDropTarget(0, 0, (p) => DIRS[p])).toBeNull();
  });
});

describe('ドラッグの開始', () => {
  it('しきい値未満の動きではドラッグが始まらない（ただのクリックを壊さない）', () => {
    session.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 0, y: 0 });
    hit = q('.pane[data-pane="right"] .pane-list');
    mouse('mousemove', 3, 0);
    expect(session.isDragging()).toBe(false);
    expect(ghost()).toBeNull();
    mouse('mouseup', 3, 0);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('ドラッグが始まったら、それまでに走った文字列選択を消す', () => {
    const p = document.createElement('p');
    p.textContent = 'some text';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    document.getSelection().addRange(range);
    expect(document.getSelection().toString()).toBe('some text');
    beginDrag();
    expect(document.getSelection().toString()).toBe('');
    p.remove();
  });

  it('しきい値を超えるとドラッグが始まりゴーストが出る', () => {
    beginDrag();
    expect(session.isDragging()).toBe(true);
    expect(ghost()).not.toBeNull();
    expect(ghost().textContent).toBe('「a.txt」をコピー');
  });

  it('ドラッグ元の行が dragging になる', () => {
    beginDrag();
    expect(q('.entry[data-path="/base/a.txt"]').classList.contains('dragging')).toBe(true);
    expect(q('.entry[data-path="/base/b.txt"]').classList.contains('dragging')).toBe(false);
  });

  it('安全モードでもドラッグは始まるが、ゴーストは拒否表示になる', () => {
    canMutate = false;
    beginDrag();
    expect(session.isDragging()).toBe(true);
    expect(ghost()).not.toBeNull();
    expect(ghost().classList.contains('denied')).toBe(true);
    // 効果を出せないので名前だけ（「コピー」「移動」を付けない）
    expect(ghost().textContent).toBe('「a.txt」');
  });

  it('安全モードでは落とせる場所も強調しない', () => {
    canMutate = false;
    beginDrag();
    expect(q('.pane[data-pane="right"]').classList.contains('drop-here')).toBe(false);
  });
});

describe('ドロップ', () => {
  it('相手ペインの余白に落とすとその現在地へコピーする', () => {
    beginDrag();
    mouse('mouseup', 20, 20);
    expect(onDrop).toHaveBeenCalledWith({
      sources: [ENTRIES[1]],
      destDir: '/other',
      effect: 'copy',
    });
  });

  it('フォルダ行に落とすとそのフォルダへ入る', () => {
    beginDrag();
    hit = q('.entry.is-dir');
    mouse('mousemove', 30, 30);
    mouse('mouseup', 30, 30);
    expect(onDrop).toHaveBeenCalledWith({
      sources: [ENTRIES[1]],
      destDir: '/base/docs',
      effect: 'copy',
    });
  });

  it('Shift を押しながら落とすと移動になる', () => {
    beginDrag();
    mouse('mousemove', 20, 20, { shiftKey: true });
    mouse('mouseup', 20, 20, { shiftKey: true });
    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ destDir: '/other', effect: 'move' }),
    );
  });

  it('選択済みの行を掴むと選択全体が対象になる', () => {
    const selected = new Set(['/base/a.txt', '/base/b.txt']);
    beginDrag('/base/a.txt', selected);
    mouse('mouseup', 20, 20);
    expect(onDrop.mock.calls[0][0].sources.map((s) => s.path)).toEqual([
      '/base/a.txt',
      '/base/b.txt',
    ]);
  });

  it('フォルダを自分自身へ落としても実行しない', () => {
    session.begin({ entries: ENTRIES, selected: new Set(), path: '/base/docs', x: 0, y: 0 });
    hit = q('.entry.is-dir'); // /base/docs 自身
    mouse('mousemove', 20, 20);
    expect(ghost().classList.contains('denied')).toBe(true);
    mouse('mouseup', 20, 20);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('ペインの外に落としても実行しない', () => {
    beginDrag();
    hit = document.body;
    mouse('mousemove', 500, 500);
    mouse('mouseup', 500, 500);
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe('安全モードでのドロップ', () => {
  it('落とせる場所に落としても実行せず、理由をトーストで伝える', () => {
    canMutate = false;
    beginDrag(); // 相手ペインの余白の上
    mouse('mouseup', 20, 20);
    expect(onDrop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('安全モードです（切替: Ctrl+Shift+Space）');
  });

  it('ペインの外に落としたとき（やめた操作）は黙る', () => {
    canMutate = false;
    beginDrag();
    hit = document.body;
    mouse('mousemove', 500, 500);
    mouse('mouseup', 500, 500);
    expect(onDrop).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('フィードバックとキャンセル', () => {
  it('落とせる場所ではペイン全体が強調される', () => {
    beginDrag();
    expect(q('.pane[data-pane="right"]').classList.contains('drop-here')).toBe(true);
  });

  it('フォルダ行の強調は drop-into を使う', () => {
    beginDrag();
    hit = q('.entry.is-dir');
    mouse('mousemove', 30, 30);
    expect(q('.entry.is-dir').classList.contains('drop-into')).toBe(true);
  });

  // 修飾キー付きの操作は noVNC 越しの GUI 検証環境では確認できない
  // （RFB の PointerEvent に修飾キーの欄が無い）ため、ここで押さえる。
  it('ドラッグ中に Shift を押すとゴーストの表示が移動に変わる', () => {
    beginDrag();
    expect(ghost().textContent).toBe('「a.txt」をコピー');
    key('keydown', 'Shift');
    expect(ghost().textContent).toBe('「a.txt」を移動');
    key('keyup', 'Shift');
    expect(ghost().textContent).toBe('「a.txt」をコピー');
  });

  it('Escape でキャンセルされ、後始末される', () => {
    beginDrag();
    key('keydown', 'Escape');
    expect(session.isDragging()).toBe(false);
    expect(ghost()).toBeNull();
    expect(q('.entry[data-path="/base/a.txt"]').classList.contains('dragging')).toBe(false);
    mouse('mouseup', 20, 20);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('ドロップ後に強調とゴーストが残らない', () => {
    beginDrag();
    mouse('mouseup', 20, 20);
    expect(ghost()).toBeNull();
    expect(document.querySelector('.drop-here')).toBeNull();
    expect(document.querySelector('.dragging')).toBeNull();
  });
});

// Tana → 外（docs/DRAG-AND-DROP.md §10）。ウィンドウの外へ出たら OS のドラッグへ引き継ぐ
describe('ウィンドウの外へ出たときの引き継ぎ', () => {
  let onLeaveWindow;
  let out;

  function makeSession() {
    session.cancel();
    onLeaveWindow = vi.fn(async () => {});
    out = createDragSession({
      getPaneDir: (pane) => DIRS[pane] || null,
      canMutate: () => canMutate,
      onDrop,
      toast,
      onLeaveWindow,
      getViewport: () => ({ width: 100, height: 100 }),
    });
    return out;
  }

  afterEach(() => out && out.cancel());

  it('外へ出たら onLeaveWindow に掴んだ対象を渡し、内部のドラッグは畳む', async () => {
    const s = makeSession();
    s.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 10, y: 10 });
    hit = q('.pane[data-pane="right"] .pane-list');
    mouse('mousemove', 30, 30);
    expect(s.isDragging()).toBe(true);
    mouse('mousemove', 130, 30);
    expect(s.isDragging()).toBe(false);
    expect(ghost()).toBeNull();
    expect(document.querySelectorAll('.dragging').length).toBe(0);
    await Promise.resolve();
    expect(onLeaveWindow).toHaveBeenCalledTimes(1);
    expect(onLeaveWindow.mock.calls[0][0].map((e) => e.path)).toEqual(['/base/a.txt']);
  });

  it('選択全体を掴んでいれば選択全体を渡す', async () => {
    const s = makeSession();
    const sel = new Set(['/base/a.txt', '/base/b.txt']);
    s.begin({ entries: ENTRIES, selected: sel, path: '/base/b.txt', x: 10, y: 10 });
    mouse('mousemove', 30, 30);
    mouse('mousemove', 30, -5);
    await Promise.resolve();
    expect(onLeaveWindow.mock.calls[0][0].map((e) => e.path)).toEqual([
      '/base/a.txt',
      '/base/b.txt',
    ]);
  });

  it('引き継ぎ後に離したら stillHeld() は false になる', async () => {
    const s = makeSession();
    let stillHeld;
    let release;
    onLeaveWindow.mockImplementation(
      (_src, held) =>
        new Promise((r) => {
          stillHeld = held;
          release = r;
        }),
    );
    s.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 10, y: 10 });
    mouse('mousemove', 30, 30);
    mouse('mousemove', 200, 30);
    await Promise.resolve();
    await Promise.resolve();
    expect(stillHeld()).toBe(true);
    mouse('mouseup', 200, 30);
    expect(stillHeld()).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    release();
  });

  it('しきい値前（ドラッグ前）に外の座標が来ても引き継がない', async () => {
    const s = makeSession();
    s.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 99, y: 10 });
    mouse('mousemove', 101, 10); // 2px: しきい値未満
    await Promise.resolve();
    expect(onLeaveWindow).not.toHaveBeenCalled();
  });

  it('縁での mouseout（relatedTarget なし）でも引き継ぐ', async () => {
    const s = makeSession();
    s.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 10, y: 10 });
    mouse('mousemove', 50, 50);
    mouse('mouseout', 99, 50);
    await Promise.resolve();
    expect(onLeaveWindow).toHaveBeenCalledTimes(1);
  });

  it('中央での mouseout（iframe へ入った等）では引き継がない', async () => {
    const s = makeSession();
    s.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 10, y: 10 });
    mouse('mousemove', 50, 50);
    mouse('mouseout', 50, 50);
    await Promise.resolve();
    expect(onLeaveWindow).not.toHaveBeenCalled();
    expect(s.isDragging()).toBe(true);
  });

  it('onLeaveWindow が無ければ外へ出ても内部のドラッグを続ける（従来どおり）', () => {
    session.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 0, y: 0 });
    hit = null;
    mouse('mousemove', 20, 20);
    mouse('mousemove', 5000, 20);
    expect(session.isDragging()).toBe(true);
  });
});

describe('引き継ぎ後の文字選択の抑止', () => {
  it('次に押されるまで selectstart を止め、押されたら戻す', async () => {
    session.cancel();
    const s = createDragSession({
      getPaneDir: (pane) => DIRS[pane] || null,
      canMutate: () => true,
      onDrop,
      toast,
      onLeaveWindow: async () => {},
      getViewport: () => ({ width: 100, height: 100 }),
    });
    s.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 10, y: 10 });
    mouse('mousemove', 30, 30);
    mouse('mousemove', 300, 30);
    await Promise.resolve();
    const ev1 = new Event('selectstart', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev1);
    expect(ev1.defaultPrevented).toBe(true);
    mouse('mousedown', 10, 10);
    const ev2 = new Event('selectstart', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
    s.cancel();
  });
});

describe('ドラッグ中の文字列選択の抑止', () => {
  it('押している間は body に dnd-active を付け、離したら外す', () => {
    session.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 0, y: 0 });
    expect(document.body.classList.contains('dnd-active')).toBe(true);
    hit = q('.pane[data-pane="right"] .pane-list');
    mouse('mousemove', 20, 20);
    expect(document.body.classList.contains('dnd-active')).toBe(true);
    mouse('mouseup', 20, 20);
    expect(document.body.classList.contains('dnd-active')).toBe(false);
  });

  it('ただのクリック・Escape でも外す', () => {
    session.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 0, y: 0 });
    mouse('mouseup', 1, 1);
    expect(document.body.classList.contains('dnd-active')).toBe(false);
    session.begin({ entries: ENTRIES, selected: new Set(), path: '/base/a.txt', x: 0, y: 0 });
    mouse('mousemove', 20, 20);
    key('keydown', 'Escape');
    expect(document.body.classList.contains('dnd-active')).toBe(false);
  });
});
