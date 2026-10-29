import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENTRIES = [
  { name: 'docs', path: '/base/docs', is_dir: true, size: 0 },
  { name: 'a.txt', path: '/base/a.txt', is_dir: false, size: 10 },
];

vi.mock('../backend.js', () => ({
  listDir: vi.fn(async () => ENTRIES),
  parentDir: vi.fn(async (p) => p.replace(/\/[^/]+$/, '') || '/'),
}));

const { createFilePane } = await import('../core/filepane.js');

let root;
let onContextMenu;
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

function rightClick(target) {
  const ev = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 240,
  });
  target.dispatchEvent(ev);
  return ev;
}

beforeEach(async () => {
  root = buildPaneDom();
  onContextMenu = vi.fn();
  pane = createFilePane(root, { onContextMenu });
  await pane.load('/base');
});

afterEach(() => {
  root.remove();
  document.body.innerHTML = '';
});

describe('一覧の右クリック', () => {
  it('行を右クリックするとその entry を渡して呼ばれる', () => {
    const rows = root.querySelectorAll('.entry');
    rightClick(rows[1]);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const info = onContextMenu.mock.calls[0][0];
    expect(info.entry.name).toBe('a.txt');
    expect(info).toMatchObject({ x: 120, y: 240 });
  });

  // 右クリックした行が対象になっていないと、メニューの操作対象が
  // 見えているものとずれて事故になる
  it('右クリックした行へカーソルが移る', () => {
    const rows = root.querySelectorAll('.entry');
    rightClick(rows[1]);
    expect(pane.getCursorEntry().name).toBe('a.txt');
    expect(root.querySelectorAll('.entry')[1].classList.contains('cursor')).toBe(true);
  });

  it('ブラウザ既定のメニューを抑止する', () => {
    const ev = rightClick(root.querySelectorAll('.entry')[0]);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('余白の右クリックは entry なしで呼ばれる', () => {
    rightClick(root.querySelector('.pane-list'));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].entry).toBeNull();
  });

  it('行の右クリックが一覧へ二重に伝播しない', () => {
    rightClick(root.querySelectorAll('.entry')[0]);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('ハンドラ未指定でも例外にならない', async () => {
    const el = buildPaneDom();
    const p = createFilePane(el, {});
    await p.load('/base');
    expect(() => rightClick(el.querySelectorAll('.entry')[0])).not.toThrow();
    el.remove();
  });
});

describe('getCursorPoint', () => {
  it('カーソル行の位置を返す（キーボードからメニューを開くため）', () => {
    const pt = pane.getCursorPoint();
    expect(typeof pt.x).toBe('number');
    expect(typeof pt.y).toBe('number');
  });

  it('一覧が空でも壊れない', async () => {
    const el = buildPaneDom();
    const p = createFilePane(el, {});
    // 空ディレクトリ
    const backend = await import('../backend.js');
    backend.listDir.mockResolvedValueOnce([]);
    await p.load('/empty');
    expect(() => p.getCursorPoint()).not.toThrow();
    el.remove();
  });
});

describe('絞り込み（setFilter / 帯）', () => {
  const bar = () => root.querySelector('.pane-filter');
  const shown = () => [...root.querySelectorAll('.entry')].map((li) => li.textContent);

  it('既定では帯を出さず全件', () => {
    expect(bar().hidden).toBe(true);
    expect(root.querySelectorAll('.entry').length).toBe(2);
    expect(pane.getFilter()).toEqual({ type: 'all', exts: [] });
  });

  it('フォルダだけにすると帯に件数つきで出て、× で外れる', () => {
    const onFilterChange = vi.fn();
    root.remove();
    root = buildPaneDom();
    pane = createFilePane(root, { onFilterChange });
    return pane.load('/base').then(() => {
      pane.setFilter({ type: 'dirs' });
      expect(root.querySelectorAll('.entry').length).toBe(1);
      expect(shown()[0]).toContain('docs');
      expect(bar().hidden).toBe(false);
      expect(bar().textContent).toContain('フォルダだけ（1 / 2 件）');
      expect(onFilterChange).toHaveBeenLastCalledWith({ type: 'dirs', exts: [] });

      bar().querySelector('.pane-filter-clear').click();
      expect(bar().hidden).toBe(true);
      expect(root.querySelectorAll('.entry').length).toBe(2);
      expect(onFilterChange).toHaveBeenLastCalledWith({ type: 'all', exts: [] });
    });
  });

  it('一致が無ければ一覧に「一致なし」を出す（帯は残す）', () => {
    pane.setFilter({ type: 'files', exts: ['pdf'] });
    expect(root.querySelectorAll('.entry').length).toBe(0);
    expect(root.querySelector('.pane-list').classList.contains('filtered-empty')).toBe(true);
    expect(bar().hidden).toBe(false);
    pane.setFilter(null);
    expect(root.querySelector('.pane-list').classList.contains('filtered-empty')).toBe(false);
  });

  it('フォルダを移っても絞り込みは掛けたまま', async () => {
    pane.setFilter({ type: 'files' });
    await pane.load('/base');
    expect(pane.getFilter().type).toBe('files');
    expect(shown().every((t) => !t.includes('docs'))).toBe(true);
  });

  it('カーソル行が残る絞り込みなら位置を保つ', () => {
    pane.moveCursor(1); // a.txt
    pane.setFilter({ type: 'files', exts: ['txt'] });
    expect(pane.getCursorEntry().name).toBe('a.txt');
  });
});
