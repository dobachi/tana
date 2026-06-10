import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFavoritesView } from '../core/favoritesview.js';
import { createFavorites } from '../core/favorites.js';

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
});
