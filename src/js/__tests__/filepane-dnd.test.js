import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENTRIES = [
  { name: 'docs', path: '/base/docs', is_dir: true, size: 0 },
  { name: 'a.txt', path: '/base/a.txt', is_dir: false, size: 10 },
  { name: 'b.txt', path: '/base/b.txt', is_dir: false, size: 20 },
];

const listDir = vi.fn(async () => ENTRIES);

vi.mock('../backend.js', () => ({
  listDir: (...a) => listDir(...a),
  parentDir: vi.fn(async (p) => p.replace(/\/[^/]+$/, '') || '/'),
}));

const { createFilePane } = await import('../core/filepane.js');

let root;
let pane;
let onDragStart;

function buildPaneDom() {
  const el = document.createElement('section');
  el.className = 'pane';
  el.dataset.pane = 'left';
  el.innerHTML = `
    <header class="pane-header">
      <span class="pane-path">—</span>
      <input class="pane-path-input" type="text" />
    </header>
    <ul class="pane-list"></ul>`;
  document.body.appendChild(el);
  return el;
}

const rows = () => [...root.querySelectorAll('.entry')];
const at = (path) => root.querySelector(`.entry[data-path="${path}"]`);
const mouse = (el, type, init = {}) =>
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, ...init }),
  );

beforeEach(async () => {
  listDir.mockClear();
  onDragStart = vi.fn();
  root = buildPaneDom();
  pane = createFilePane(root, { onDragStart });
  await pane.load('/base');
});

afterEach(() => {
  root.remove();
});

describe('ドロップ先の解決に必要な情報', () => {
  it('行にパスが載っている（core/dragdrop.js が使う）', () => {
    expect(rows().map((r) => r.dataset.path)).toEqual(['/base/docs', '/base/a.txt', '/base/b.txt']);
  });

  it('フォルダ行は is-dir で見分けられる', () => {
    expect(at('/base/docs').classList.contains('is-dir')).toBe(true);
    expect(at('/base/a.txt').classList.contains('is-dir')).toBe(false);
  });
});

describe('onDragStart', () => {
  it('mousedown で掴んだ行のパスと座標を通知する', () => {
    mouse(at('/base/a.txt'), 'mousedown', { clientX: 12, clientY: 34 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    const info = onDragStart.mock.calls[0][0];
    expect(info.path).toBe('/base/a.txt');
    expect({ x: info.x, y: info.y }).toEqual({ x: 12, y: 34 });
    expect(info.entries.map((e) => e.path)).toEqual(rows().map((r) => r.dataset.path));
  });
});

// 素直に applyClick を先に適用すると、無修飾クリックが選択を1件に畳んでしまい、
// 複数選択したままドラッグできなくなる。畳むのは mouseup まで遅らせている。
describe('複数選択のままドラッグできること', () => {
  const selectTwo = () => {
    mouse(at('/base/a.txt'), 'mousedown', { ctrlKey: true });
    mouse(at('/base/b.txt'), 'mousedown', { ctrlKey: true });
  };

  it('選択済みの行を無修飾で掴んだ時点では選択が畳まれない', () => {
    selectTwo();
    expect(pane.getSelectedCount()).toBe(2);
    mouse(at('/base/a.txt'), 'mousedown');
    expect(pane.getSelectedCount()).toBe(2);
    // onDragStart にも選択全体が渡っている
    const info = onDragStart.mock.calls.at(-1)[0];
    expect([...info.selected]).toEqual(['/base/a.txt', '/base/b.txt']);
  });

  it('動かさずに離したら（＝ただのクリック）選択が1件に畳まれる', () => {
    selectTwo();
    mouse(at('/base/a.txt'), 'mousedown');
    mouse(at('/base/a.txt'), 'mouseup');
    expect(pane.getSelectedCount()).toBe(1);
    expect(at('/base/a.txt').classList.contains('selected')).toBe(true);
  });

  it('しきい値を超えて動かしてから離したら選択は保たれる（ドラッグだった）', () => {
    selectTwo();
    mouse(at('/base/a.txt'), 'mousedown', { clientX: 0, clientY: 0 });
    mouse(at('/base/a.txt'), 'mouseup', { clientX: 40, clientY: 0 });
    expect(pane.getSelectedCount()).toBe(2);
  });

  it('選択外の行を無修飾で掴んだ場合は従来どおり即座に選択が移る', () => {
    selectTwo();
    mouse(at('/base/docs'), 'mousedown');
    expect(pane.getSelectedCount()).toBe(1);
    expect(at('/base/docs').classList.contains('selected')).toBe(true);
  });

  it('単一選択のときは掴んだ時点で確定する（保留しない）', () => {
    mouse(at('/base/a.txt'), 'mousedown', { ctrlKey: true });
    expect(pane.getSelectedCount()).toBe(1);
    mouse(at('/base/a.txt'), 'mousedown');
    expect(pane.getSelectedCount()).toBe(1);
  });
});

describe('安全モードでも選択操作は壊れない', () => {
  it('Ctrl+クリックの選択は従来どおり動く', () => {
    mouse(at('/base/a.txt'), 'mousedown', { ctrlKey: true });
    expect(at('/base/a.txt').classList.contains('selected')).toBe(true);
    mouse(at('/base/a.txt'), 'mousedown', { ctrlKey: true });
    expect(at('/base/a.txt').classList.contains('selected')).toBe(false);
  });
});

// 右クリックは mousedown → contextmenu → mouseup と流れる。ここで選択に触ると
// (1) 右クリックしてから動かすだけでドラッグが始まる
// (2) contextmenu 側の「選択済みの行なら選択を保つ」が効かず1件に畳まれる
describe('右クリックは選択にもドラッグにも関与しない', () => {
  const selectTwo = () => {
    mouse(at('/base/a.txt'), 'mousedown', { ctrlKey: true });
    mouse(at('/base/b.txt'), 'mousedown', { ctrlKey: true });
  };

  it('右クリックではドラッグが始まらない', () => {
    mouse(at('/base/a.txt'), 'mousedown', { button: 2 });
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('選択済みの行を右クリックしても複数選択が保たれる', () => {
    selectTwo();
    mouse(at('/base/a.txt'), 'mousedown', { button: 2 });
    mouse(at('/base/a.txt'), 'mouseup', { button: 2 });
    expect(pane.getSelectedCount()).toBe(2);
  });

  it('右クリックの mouseup が保留中の選択解除を発火させない', () => {
    selectTwo();
    mouse(at('/base/a.txt'), 'mousedown'); // 左で掴んで保留状態にする
    mouse(at('/base/a.txt'), 'mouseup', { button: 2 });
    expect(pane.getSelectedCount()).toBe(2);
  });

  it('中ボタンでもドラッグは始まらない', () => {
    mouse(at('/base/a.txt'), 'mousedown', { button: 1 });
    expect(onDragStart).not.toHaveBeenCalled();
  });
});
