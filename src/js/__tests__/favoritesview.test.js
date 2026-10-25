import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFavoritesView } from '../core/favoritesview.js';
import { createFavorites } from '../core/favorites.js';
import { createFavViewState } from '../core/favarrange.js';

function mount() {
  document.body.innerHTML = '<input id="s"><ul id="l"></ul>';
  return {
    listEl: document.getElementById('l'),
    searchEl: document.getElementById('s'),
  };
}

describe('favoritesview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('空のときはプレースホルダを表示', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    createFavoritesView({ listEl, searchEl, favorites, onNavigate: vi.fn() });
    expect(listEl.querySelector('.placeholder')).not.toBeNull();
  });

  it('ツリー（フォルダ＋ブックマーク）を描画する', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    const fid = favorites.addFolder('仕事');
    favorites.addBookmark('提案', '/work/p', fid);
    favorites.addBookmark('家', '/home');
    createFavoritesView({ listEl, searchEl, favorites, onNavigate: vi.fn() });

    expect(listEl.querySelectorAll('.fav-folder')).toHaveLength(1);
    expect(listEl.querySelectorAll('.fav-bookmark')).toHaveLength(2); // 提案(子) + 家
    expect(listEl.querySelector('.fav-folder .fav-name').textContent).toBe('仕事');
  });

  it('ブックマーククリックで onNavigate(path)', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    favorites.addBookmark('家', '/home/me');
    const onNavigate = vi.fn();
    createFavoritesView({ listEl, searchEl, favorites, onNavigate });
    listEl.querySelector('.fav-bookmark .fav-row').click();
    expect(onNavigate).toHaveBeenCalledWith('/home/me');
  });

  it('削除ボタンでノードを除去', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    favorites.addBookmark('家', '/home');
    createFavoritesView({ listEl, searchEl, favorites, onNavigate: vi.fn() });
    listEl.querySelector('.fav-remove').click();
    expect(favorites.getRoot()).toHaveLength(0);
    expect(listEl.querySelector('.placeholder')).not.toBeNull();
  });

  it('focusFirst で先頭行にフォーカス、isFocused が true', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    favorites.addBookmark('a', '/a');
    favorites.addBookmark('b', '/b');
    const view = createFavoritesView({ listEl, searchEl, favorites, onNavigate: vi.fn() });
    view.focusFirst();
    expect(view.isFocused()).toBe(true);
    expect(document.activeElement).toBe(listEl.querySelectorAll('.fav-row')[0]);
  });

  it('j/k でフォーカス移動、Enter で navigate', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    favorites.addBookmark('a', '/a');
    favorites.addBookmark('b', '/b');
    const onNavigate = vi.fn();
    const view = createFavoritesView({ listEl, searchEl, favorites, onNavigate });
    view.focusFirst();
    listEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(document.activeElement).toBe(listEl.querySelectorAll('.fav-row')[1]);
    listEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onNavigate).toHaveBeenCalledWith('/b');
  });

  it('Escape で onReturn を呼ぶ', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    favorites.addBookmark('a', '/a');
    const onReturn = vi.fn();
    const view = createFavoritesView({
      listEl,
      searchEl,
      favorites,
      onNavigate: vi.fn(),
      onReturn,
    });
    view.focusFirst();
    listEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onReturn).toHaveBeenCalled();
  });

  it('l でフォルダ展開、h で折りたたみ', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    const fid = favorites.addFolder('A');
    favorites.toggleOpen(fid); // 閉じる
    favorites.addBookmark('child', '/c', fid);
    const view = createFavoritesView({ listEl, searchEl, favorites, onNavigate: vi.fn() });
    view.focusFirst(); // フォルダ行
    expect(favorites.find(fid).open).toBe(false);
    listEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(favorites.find(fid).open).toBe(true);
    listEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(favorites.find(fid).open).toBe(false);
  });

  it('検索入力で平坦な結果に絞り込む', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    const fid = favorites.addFolder('仕事');
    favorites.addBookmark('提案書', '/work/proposal', fid);
    favorites.addBookmark('家', '/home');
    createFavoritesView({ listEl, searchEl, favorites, onNavigate: vi.fn() });

    searchEl.value = '提案';
    searchEl.dispatchEvent(new Event('input'));
    const items = listEl.querySelectorAll('.fav-bookmark');
    expect(items).toHaveLength(1);
    expect(listEl.querySelector('.fav-breadcrumb').textContent).toBe('仕事');
  });

  it('リモートのブックマークは 🌐 付きで、クリックで sftp:// の場所へ (FR-20)', () => {
    const { listEl, searchEl } = mount();
    const favorites = createFavorites();
    favorites.addBookmark('k16:notes', 'sftp://k16/home/u/notes');
    favorites.addBookmark('local', '/home/u');
    const onNavigate = vi.fn();
    createFavoritesView({ listEl, searchEl, favorites, onNavigate });
    const rows = listEl.querySelectorAll('.fav-bookmark');
    expect(rows[0].classList.contains('fav-remote')).toBe(true);
    expect(rows[0].querySelector('.fav-remote-mark').title).toBe('k16');
    expect(rows[0].querySelector('.fav-row').title).toBe('k16:/home/u/notes');
    expect(rows[1].querySelector('.fav-remote-mark')).toBeNull();
    rows[0].querySelector('.fav-row').click();
    expect(onNavigate).toHaveBeenCalledWith('sftp://k16/home/u/notes');
  });
});

function mount2() {
  document.body.innerHTML =
    '<button id="o"></button><input id="s"><div id="t"></div><ul id="l"></ul>';
  return {
    listEl: document.getElementById('l'),
    searchEl: document.getElementById('s'),
    tagsEl: document.getElementById('t'),
    optionsBtn: document.getElementById('o'),
  };
}
const rowNames = (listEl) =>
  [...listEl.querySelectorAll('.fav-row .fav-name')].map((e) => e.textContent);
const press = (el, key, opts = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));

describe('favoritesview — 並べ替え・まとめ方・タグ', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function make(over = {}) {
    const els = mount2();
    let t = 0;
    const favorites = createFavorites([], { now: () => (t += 1) });
    const viewState = over.viewState || createFavViewState();
    const deps = {
      ...els,
      favorites,
      viewState,
      onNavigate: vi.fn(),
      notify: vi.fn(),
      showMenu: vi.fn(),
      promptName: over.promptName,
      hitTest: over.hitTest,
    };
    const view = createFavoritesView(deps);
    return { ...els, favorites, viewState, view, deps };
  }

  it('自動の並べ替え（名前順/登録日順・昇降）を切り替えると描き直す', () => {
    const { listEl, favorites, viewState } = make();
    favorites.addBookmark('b', '/b');
    favorites.addBookmark('c', '/c');
    favorites.addBookmark('a', '/a');
    expect(rowNames(listEl)).toEqual(['b', 'c', 'a']); // 手動 = 登録した並び
    viewState.update({ sort: 'name' });
    expect(rowNames(listEl)).toEqual(['a', 'b', 'c']);
    viewState.update({ order: 'desc' });
    expect(rowNames(listEl)).toEqual(['c', 'b', 'a']);
    viewState.update({ sort: 'added' });
    expect(rowNames(listEl)).toEqual(['a', 'c', 'b']); // 新しい順
  });

  it('接続先でまとめると見出しが付き、クリック・h/l でたためる', () => {
    const { listEl, favorites, viewState, view } = make();
    favorites.addBookmark('home', '/home/u');
    favorites.addBookmark('k-notes', 'sftp://k16/notes');
    viewState.update({ group: 'host' });
    const groups = [...listEl.querySelectorAll('.fav-group-row .fav-name')].map(
      (e) => e.textContent,
    );
    expect(groups).toEqual(['このPC', 'k16']);
    expect(rowNames(listEl)).toEqual(['このPC', 'home', 'k16', 'k-notes']);
    listEl.querySelectorAll('.fav-group-row')[1].click();
    expect(viewState.isCollapsed('host:k16')).toBe(true);
    expect(rowNames(listEl)).toEqual(['このPC', 'home', 'k16']);
    view.focusFirst(); // このPC の見出し
    press(listEl, 'h');
    expect(viewState.isCollapsed('local')).toBe(true);
    press(listEl, 'l');
    expect(viewState.isCollapsed('local')).toBe(false);
    expect(listEl.querySelectorAll('.fav-count')[0].textContent).toBe('1');
  });

  it('タグでまとめる・チップで絞り込む・#タグで検索する', () => {
    const { listEl, searchEl, tagsEl, favorites, viewState } = make();
    favorites.setTags(favorites.addBookmark('a', '/a'), 'work');
    favorites.setTags(favorites.addBookmark('b', '/b'), 'work home');
    favorites.addBookmark('c', '/c');
    expect([...tagsEl.querySelectorAll('.fav-tag')].map((e) => e.textContent)).toEqual([
      '#home',
      '#work',
    ]);
    viewState.update({ group: 'tag' });
    expect(rowNames(listEl)).toEqual(['#home', 'b', '#work', 'a', 'b', 'タグなし', 'c']);

    tagsEl.querySelectorAll('.fav-tag')[1].click(); // #work
    expect(viewState.get().tag).toBe('work');
    expect(rowNames(listEl)).toEqual(['a', 'b']);
    tagsEl.querySelectorAll('.fav-tag')[1].click(); // もう一度で外す
    expect(viewState.get().tag).toBeNull();

    searchEl.value = '#home';
    searchEl.dispatchEvent(new Event('input'));
    expect(rowNames(listEl)).toEqual(['b']);
  });

  it('タグが無ければチップ欄を隠す', () => {
    const { tagsEl, favorites } = make();
    favorites.addBookmark('a', '/a');
    expect(tagsEl.hidden).toBe(true);
  });

  it('t でタグを編集する', async () => {
    const promptName = vi.fn(async () => '#x y');
    const { listEl, favorites, view } = make({ promptName });
    const id = favorites.addBookmark('a', '/a');
    view.focusFirst();
    press(listEl, 't');
    await Promise.resolve();
    await Promise.resolve();
    expect(promptName).toHaveBeenCalledWith(expect.stringContaining('タグ'), '');
    expect(favorites.find(id).tags).toEqual(['x', 'y']);
  });

  it('Alt+↑/↓/→/← で手動の並びを変え、フォーカスは動かした行に付いていく', () => {
    const { listEl, favorites, view } = make();
    const F = favorites.addFolder('F');
    favorites.addBookmark('a', '/a');
    favorites.addBookmark('b', '/b');
    view.focusFirst();
    press(listEl, 'j'); // a
    press(listEl, 'ArrowDown', { altKey: true });
    expect(rowNames(listEl)).toEqual(['F', 'b', 'a']);
    expect(document.activeElement.textContent).toContain('a');
    press(listEl, 'ArrowUp', { altKey: true });
    press(listEl, 'ArrowRight', { altKey: true }); // 直前の F へ
    expect(favorites.find(F).children.map((n) => n.name)).toEqual(['a']);
    press(listEl, 'ArrowLeft', { altKey: true });
    expect(rowNames(listEl)).toEqual(['F', 'a', 'b']);
  });

  it('自動の並べ替え中は Alt+↑ で動かさず案内する', () => {
    const { listEl, favorites, viewState, view, deps } = make();
    favorites.addBookmark('a', '/a');
    favorites.addBookmark('b', '/b');
    viewState.update({ sort: 'name' });
    view.focusFirst();
    press(listEl, 'ArrowDown', { altKey: true });
    expect(favorites.toJSON().map((n) => n.name)).toEqual(['a', 'b']);
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('手動'));
  });

  function dragRows(listEl, from, to, offsetY) {
    const fromRow = [...listEl.querySelectorAll('.fav-row')].find((r) =>
      r.textContent.includes(from),
    );
    const toRow = [...listEl.querySelectorAll('.fav-row')].find((r) => r.textContent.includes(to));
    toRow.getBoundingClientRect = () => ({ top: 100, height: 20, left: 0, bottom: 120 });
    fromRow.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }),
    );
    document.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 0, clientY: 100 + offsetY }),
    );
    const marked = listEl.querySelector('.fav-drop-before, .fav-drop-after, .fav-drop-into');
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    return { toRow, marked };
  }

  it('ドラッグで前後へ並べ替え、フォルダの中央へ落とすと中へ入れる', () => {
    let target = null;
    const { listEl, favorites, deps } = make({ hitTest: () => target });
    const F = favorites.addFolder('F');
    favorites.addBookmark('a', '/a');
    favorites.addBookmark('b', '/b');
    target = [...listEl.querySelectorAll('.fav-row')].find((r) => r.textContent.includes('F'));
    let res = dragRows(listEl, 'b', 'F', 2); // F の上端 → 前
    expect(res.marked).toBe(res.toRow);
    expect(favorites.toJSON().map((n) => n.name)).toEqual(['b', 'F', 'a']);

    target = [...listEl.querySelectorAll('.fav-row')].find((r) => r.textContent.includes('F'));
    dragRows(listEl, 'a', 'F', 10); // 中央 → 中
    expect(favorites.find(F).children.map((n) => n.name)).toEqual(['a']);
    expect(deps.onNavigate).not.toHaveBeenCalled();
  });

  it('自動の並べ替え中はドラッグで動かさない', () => {
    let target = null;
    const { listEl, favorites, viewState, deps } = make({ hitTest: () => target });
    favorites.addBookmark('a', '/a');
    favorites.addBookmark('b', '/b');
    viewState.update({ sort: 'added', order: 'desc' });
    target = [...listEl.querySelectorAll('.fav-row')].find((r) => r.textContent.includes('b'));
    dragRows(listEl, 'a', 'b', 2);
    expect(favorites.toJSON().map((n) => n.name)).toEqual(['a', 'b']);
    expect(deps.notify).toHaveBeenCalled();
  });

  it('⇅ のメニューで並べ方とまとめ方を選ぶ（手動では昇降を選べない）', () => {
    const { optionsBtn, viewState, deps } = make();
    optionsBtn.click();
    const items = deps.showMenu.mock.calls[0][2];
    const byLabel = (re) => items.find((i) => i.label && re.test(i.label));
    expect(byLabel(/手動/).label.startsWith('✓')).toBe(true);
    expect(byLabel(/昇順/).disabled).toBe(true);
    byLabel(/名前順/).action();
    byLabel(/接続先/).action();
    expect(viewState.get()).toMatchObject({ sort: 'name', group: 'host' });
    expect(optionsBtn.classList.contains('active')).toBe(true);
    expect(optionsBtn.title).toContain('名前順');
  });
});
