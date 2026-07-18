import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENTRIES = [
  { name: 'docs', path: '/base/docs', is_dir: true, size: 0 },
  { name: 'src', path: '/base/src', is_dir: true, size: 0 },
  { name: 'a.txt', path: '/base/a.txt', is_dir: false, size: 10 },
];

const listDir = vi.fn(async () => ENTRIES);

vi.mock('../backend.js', () => ({
  listDir: (...a) => listDir(...a),
  parentDir: vi.fn(async (p) => p.replace(/\/[^/]+$/, '') || '/'),
}));

const { createFilePane } = await import('../core/filepane.js');

let root;
let pane;

function buildPaneDom() {
  const el = document.createElement('section');
  el.className = 'pane';
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
const mousedown = (el, init = {}) =>
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init }));

beforeEach(async () => {
  listDir.mockClear();
  root = buildPaneDom();
  pane = createFilePane(root, {});
  await pane.load('/base');
});

afterEach(() => {
  root.remove();
});

// 回帰: クリックのたびに一覧を作り直していたため、1回目と2回目のクリックが
// 別の DOM ノードに当たり、ブラウザは dblclick を <ul> に発火させていた。
// その結果 <li> のダブルクリックが効かず、フォルダを開けなかった。
describe('ダブルクリックでフォルダを開く', () => {
  it('クリックしても行の DOM ノードが作り直されない', () => {
    const before = rows()[0];
    mousedown(before);
    expect(rows()[0]).toBe(before); // 同一ノードであること = dblclick が成立する
    expect(before.isConnected).toBe(true);
  });

  it('別の行をクリックしても既存ノードは使い回される', () => {
    const before = rows();
    mousedown(before[2]);
    const after = rows();
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it('クリックでカーソルは移動する（表示は更新される）', () => {
    mousedown(rows()[2]);
    expect(rows()[2].classList.contains('cursor')).toBe(true);
    expect(rows()[0].classList.contains('cursor')).toBe(false);
    expect(pane.getCursorEntry().name).toBe('a.txt');
  });

  it('Ctrl+クリックの選択表示も同じノード上で更新される', () => {
    const row = rows()[1];
    mousedown(row, { ctrlKey: true });
    expect(rows()[1]).toBe(row);
    expect(row.classList.contains('selected')).toBe(true);
  });

  it('ダブルクリックでディレクトリに入る', async () => {
    const row = rows()[0]; // docs/
    mousedown(row);
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(listDir).toHaveBeenCalledWith('/base/docs');
  });

  it('ファイルのダブルクリックでは移動しない', async () => {
    const row = rows()[2]; // a.txt
    mousedown(row);
    listDir.mockClear();
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(listDir).not.toHaveBeenCalled();
  });

  it('ディレクトリを読み込み直したときは作り直す（内容が変わるため）', async () => {
    const before = rows()[0];
    await pane.load('/base');
    expect(rows()[0]).not.toBe(before);
  });
});
