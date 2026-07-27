import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSearch } from '../core/searchview.js';

const HITS = [
  { path: '/root/a.txt', name: 'a.txt', is_dir: false, kind: 'name', line_no: null, line: null },
  {
    path: '/root/sub/b.txt',
    name: 'b.txt',
    is_dir: false,
    kind: 'content',
    line_no: 3,
    line: 'has foo here',
  },
];

function typeQuery(v) {
  const input = document.querySelector('.search-input');
  input.value = v;
  input.dispatchEvent(new Event('input'));
}

describe('createSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('open で入力欄付きオーバーレイを出す', () => {
    const view = createSearch({ searchDir: vi.fn(), getDir: () => '/root', onOpen: vi.fn() });
    view.open();
    expect(view.isOpen()).toBe(true);
    expect(document.querySelector('.search-input')).not.toBeNull();
  });

  it('入力（デバウンス後）で searchDir を呼び結果を描画する', async () => {
    const searchDir = vi.fn(async () => HITS);
    const view = createSearch({ searchDir, getDir: () => '/root', onOpen: vi.fn() });
    view.open();
    typeQuery('foo');
    await vi.advanceTimersByTimeAsync(300);
    expect(searchDir).toHaveBeenCalledWith('/root', 'foo', { includeHidden: false });
    const rows = document.querySelectorAll('.search-row');
    expect(rows).toHaveLength(2);
    // content ヒットは path:line と本文
    expect(rows[1].textContent).toContain('sub/b.txt:3');
    expect(rows[1].textContent).toContain('has foo here');
  });

  it('空クエリでは検索しない', async () => {
    const searchDir = vi.fn(async () => HITS);
    const view = createSearch({ searchDir, getDir: () => '/root', onOpen: vi.fn() });
    view.open();
    typeQuery('   ');
    await vi.advanceTimersByTimeAsync(300);
    expect(searchDir).not.toHaveBeenCalled();
  });

  it('結果クリックで onOpen を呼び閉じる', async () => {
    const onOpen = vi.fn();
    const view = createSearch({ searchDir: async () => HITS, getDir: () => '/root', onOpen });
    view.open();
    typeQuery('foo');
    await vi.advanceTimersByTimeAsync(300);
    document.querySelectorAll('.search-row')[0].click();
    expect(onOpen).toHaveBeenCalledWith(HITS[0]);
    expect(view.isOpen()).toBe(false);
  });

  it('一致なしはプレースホルダ', async () => {
    const view = createSearch({
      searchDir: async () => [],
      getDir: () => '/root',
      onOpen: vi.fn(),
    });
    view.open();
    typeQuery('zzz');
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('.search-list .placeholder')).not.toBeNull();
  });

  it('Escape で閉じる', () => {
    const view = createSearch({ searchDir: vi.fn(), getDir: () => '/root', onOpen: vi.fn() });
    view.open();
    document
      .querySelector('.search-overlay')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.isOpen()).toBe(false);
  });
});
