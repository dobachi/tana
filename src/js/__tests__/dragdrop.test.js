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
