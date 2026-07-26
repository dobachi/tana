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

let onOpenFile;

beforeEach(async () => {
  listDir.mockClear();
  onOpenFile = vi.fn();
  root = buildPaneDom();
  pane = createFilePane(root, { onOpenFile });
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

  it('ファイルのダブルクリックではディレクトリ移動しない', async () => {
    const row = rows()[2]; // a.txt
    mousedown(row);
    listDir.mockClear();
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(listDir).not.toHaveBeenCalled();
  });

  it('ファイルのダブルクリックで onOpenFile が呼ばれる（既定アプリで開く）', async () => {
    const row = rows()[2]; // a.txt
    mousedown(row);
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile.mock.calls[0][0].name).toBe('a.txt');
  });

  it('フォルダのダブルクリックでは onOpenFile を呼ばない（中に入る）', async () => {
    const row = rows()[0]; // docs
    mousedown(row);
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(listDir).toHaveBeenCalledWith('/base/docs');
  });

  it('ディレクトリを読み込み直したときは作り直す（内容が変わるため）', async () => {
    const before = rows()[0];
    await pane.load('/base');
    expect(rows()[0]).not.toBe(before);
  });
});

// Enter キー経路（app.js が fp.enter() を呼ぶ）。dblclick と同じ enter() を通す。
describe('enter() — キーボードでの開く', () => {
  it('カーソルがファイルなら onOpenFile を呼ぶ', async () => {
    mousedown(rows()[2]); // a.txt にカーソル
    await pane.enter();
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile.mock.calls[0][0].name).toBe('a.txt');
    expect(listDir).not.toHaveBeenCalledWith('/base/a.txt');
  });

  it('カーソルがフォルダなら中に入り、onOpenFile は呼ばない', async () => {
    mousedown(rows()[0]); // docs にカーソル
    listDir.mockClear();
    await pane.enter();
    expect(listDir).toHaveBeenCalledWith('/base/docs');
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
