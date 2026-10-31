import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 「..」（親フォルダへ戻る行）: 一覧の先頭に出し、選択・操作の対象にはしない
const ENTRIES = {
  '/base': [
    { name: 'docs', path: '/base/docs', is_dir: true, size: 0 },
    { name: 'a.txt', path: '/base/a.txt', is_dir: false, size: 10 },
  ],
  '/': [{ name: 'base', path: '/base', is_dir: true, size: 0 }],
};

vi.mock('../backend.js', () => ({
  listDir: vi.fn(async (d) => ENTRIES[d] || []),
  // ルートの親はルート自身（Rust の parent_dir と同じく「上が無い」）
  parentDir: vi.fn(async (p) => (p === '/' ? null : p.replace(/\/[^/]+$/, '') || '/')),
}));

const { createFilePane, upEntry, realCount } = await import('../core/filepane.js');

let root;
let pane;
let onChange;
let onContextMenu;
let onDragStart;

function buildPaneDom() {
  const el = document.createElement('section');
  el.className = 'pane';
  el.dataset.pane = 'left';
  el.innerHTML = `<header class="pane-header"><span class="pane-path">—</span>
    <input class="pane-path-input" type="text" /></header><ul class="pane-list"></ul>`;
  document.body.appendChild(el);
  return el;
}
const allRows = () => [...root.querySelectorAll('.entry')];
const upRow = () => root.querySelector('.entry.is-parent');
const fire = (el, type, init = {}) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));

beforeEach(async () => {
  onChange = vi.fn();
  onContextMenu = vi.fn();
  onDragStart = vi.fn();
  root = buildPaneDom();
  pane = createFilePane(root, { onChange, onContextMenu, onDragStart });
  await pane.load('/base');
});

afterEach(() => {
  root.remove();
  document.body.innerHTML = '';
});

describe('「..」の行', () => {
  it('先頭に出て、親フォルダのパスを持つ（ドロップすると親へコピーできる）', () => {
    expect(allRows()[0]).toBe(upRow());
    expect(upRow().textContent).toContain('..');
    expect(upRow().classList.contains('is-dir')).toBe(true);
    expect(upRow().dataset.path).toBe('/');
  });

  it('ルートでは出さない', async () => {
    await pane.load('/');
    expect(upRow()).toBeNull();
  });

  it('並び順・絞り込みに関係なく先頭。絞り込みで全部消えても残る', () => {
    pane.setFilter({ type: 'files', exts: ['pdf'] });
    expect(allRows().length).toBe(1);
    expect(allRows()[0]).toBe(upRow());
    expect(root.querySelector('.pane-list').classList.contains('filtered-empty')).toBe(true);
  });

  it('入った直後のカーソルは「..」ではなく最初の項目', () => {
    expect(pane.getCursorEntry().name).toBe('docs');
  });

  it('件数に数えない', () => {
    expect(pane.getCount()).toBe(2);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ count: 2 }));
  });

  it('ダブルクリック・Enter でひとつ上へ。元いたフォルダにカーソルが合う', async () => {
    fire(upRow(), 'dblclick');
    await vi.waitFor(() => expect(pane.getCurrentDir()).toBe('/'));
    expect(pane.getCursorEntry().path).toBe('/base');

    await pane.load('/base');
    pane.moveCursorTo('top');
    await pane.enter();
    expect(pane.getCurrentDir()).toBe('/');
  });

  it('カーソルを置いても対象は無し（コピー・削除・プレビュー・名前変更に渡らない）', () => {
    fire(upRow(), 'mousedown');
    expect(pane.getCursorEntry()).toBeNull();
    expect(pane.getTargetEntries()).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ entry: null }));
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('全選択・Space・Shift+クリックの範囲でも選ばれない', () => {
    pane.selectAllEntries();
    expect(pane.getTargetEntries().map((e) => e.name)).toEqual(['docs', 'a.txt']);
    expect(upRow().classList.contains('selected')).toBe(false);

    pane.clearSelection();
    pane.moveCursorTo('top');
    pane.toggleSelection(); // 「..」の上では選ばず、カーソルだけ下へ
    expect(pane.getSelectedCount()).toBe(0);
    expect(pane.getCursorEntry().name).toBe('docs');

    fire(allRows()[2], 'mousedown'); // a.txt
    fire(upRow(), 'mousedown');
    fire(allRows()[2], 'mousedown', { shiftKey: true });
    expect(pane.getTargetEntries().every((e) => !e.is_parent)).toBe(true);
  });

  it('右クリックは空き所と同じ扱い（entry 無し）', () => {
    fire(upRow(), 'contextmenu', { button: 2 });
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ entry: null }));
  });
});

describe('upEntry / realCount', () => {
  it('「..」の行の形と、それを除いた件数', () => {
    expect(upEntry('/p')).toMatchObject({ name: '..', path: '/p', is_dir: true, is_parent: true });
    expect(realCount([upEntry('/p'), { name: 'a' }])).toBe(1);
    expect(realCount([{ name: 'a' }])).toBe(1);
    expect(realCount([])).toBe(0);
  });
});
