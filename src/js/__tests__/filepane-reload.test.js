import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 再読込（コピー後・自動更新）で見ていた位置が先頭へ戻らないこと。
const DIRS = {
  '/base': Array.from({ length: 50 }, (_, i) => ({
    name: `f${String(i).padStart(2, '0')}.txt`,
    path: `/base/f${String(i).padStart(2, '0')}.txt`,
    is_dir: false,
    size: 1,
  })),
  '/other': [{ name: 'x', path: '/other/x', is_dir: false, size: 1 }],
};
const listDir = vi.fn(async (dir) => DIRS[dir].slice());

vi.mock('../backend.js', () => ({
  listDir: (...a) => listDir(...a),
  parentDir: vi.fn(async (p) => p.replace(/\/[^/]+$/, '') || '/'),
}));

const { createFilePane } = await import('../core/filepane.js');

let root;
let pane;
let listEl;
let scrollTop;

beforeEach(async () => {
  root = document.createElement('section');
  root.innerHTML =
    '<span class="pane-path"></span><input class="pane-path-input"><ul class="pane-list"></ul>';
  document.body.appendChild(root);
  listEl = root.querySelector('.pane-list');
  // jsdom はレイアウトを持たないので、スクロール位置は「空にすると 0 へ戻る」箱で真似る
  scrollTop = 0;
  Object.defineProperty(listEl, 'scrollTop', {
    configurable: true,
    get: () => (listEl.children.length ? scrollTop : 0),
    set: (v) => {
      scrollTop = listEl.children.length ? v : 0;
    },
  });
  pane = createFilePane(root, {});
  await pane.load('/base');
});

afterEach(() => {
  root.remove();
  DIRS['/base'] = DIRS['/base'].filter((e) => !e.path.endsWith('new.txt'));
});

describe('再読込で見ていた位置を保つ', () => {
  it('reload はカーソル（パス）と表示位置を保つ', async () => {
    pane.moveCursor(30);
    listEl.scrollTop = 400;
    DIRS['/base'].unshift({ name: '00new.txt', path: '/base/00new.txt', is_dir: false, size: 1 });
    await pane.reload();
    expect(pane.getCursorEntry().path).toBe('/base/f30.txt');
    expect(listEl.scrollTop).toBe(400);
  });

  it('別のフォルダへ移ったら先頭から', async () => {
    listEl.scrollTop = 400;
    await pane.load('/other');
    expect(listEl.scrollTop).toBe(0);
  });
});
