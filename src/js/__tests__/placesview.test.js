import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPlacesView } from '../core/placesview.js';

function mount() {
  document.body.innerHTML = '<ul id="l"></ul>';
  return document.getElementById('l');
}

const PLACES = [
  { name: 'C:', path: 'C:/', kind: 'drive' },
  { name: 'I:', path: 'I:/', kind: 'drive' },
  { name: 'ホーム', path: 'C:/Users/x', kind: 'home' },
];

function key(el, k) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

describe('placesview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('場所の一覧を描画する（名前・種別クラス・title=パス）', () => {
    const listEl = mount();
    const view = createPlacesView({ listEl, onNavigate: vi.fn() });
    view.render(PLACES);
    const rows = listEl.querySelectorAll('.place-row');
    expect(rows).toHaveLength(3);
    expect([...rows].map((r) => r.textContent)).toEqual(['C:', 'I:', 'ホーム']);
    expect(listEl.querySelector('.place-drive')).not.toBeNull();
    expect(rows[0].title).toBe('C:/');
  });

  it('空/未検出のときはプレースホルダ', () => {
    const listEl = mount();
    const view = createPlacesView({ listEl, onNavigate: vi.fn() });
    view.render([]);
    expect(listEl.querySelector('.placeholder')).not.toBeNull();
    expect(listEl.querySelectorAll('.place-row')).toHaveLength(0);
  });

  it('クリックで onNavigate(パス) を呼ぶ', () => {
    const listEl = mount();
    const onNavigate = vi.fn();
    const view = createPlacesView({ listEl, onNavigate });
    view.render(PLACES);
    listEl.querySelectorAll('.place-row')[1].click();
    expect(onNavigate).toHaveBeenCalledWith('I:/');
  });

  it('focusFirst で先頭にフォーカス、isFocused が true', () => {
    const listEl = mount();
    const view = createPlacesView({ listEl, onNavigate: vi.fn() });
    view.render(PLACES);
    view.focusFirst();
    expect(document.activeElement).toBe(listEl.querySelectorAll('.place-row')[0]);
    expect(view.isFocused()).toBe(true);
  });

  it('j/k でフォーカスが移動する', () => {
    const listEl = mount();
    const view = createPlacesView({ listEl, onNavigate: vi.fn() });
    view.render(PLACES);
    view.focusFirst();
    const rows = listEl.querySelectorAll('.place-row');
    key(rows[0], 'j');
    expect(document.activeElement).toBe(rows[1]);
    key(rows[1], 'k');
    expect(document.activeElement).toBe(rows[0]);
  });

  it('Enter / l で選択中の場所へ移動', () => {
    const listEl = mount();
    const onNavigate = vi.fn();
    const view = createPlacesView({ listEl, onNavigate });
    view.render(PLACES);
    view.focusFirst();
    key(listEl.querySelectorAll('.place-row')[0], 'Enter');
    expect(onNavigate).toHaveBeenCalledWith('C:/');
  });

  it('Esc / Tab で onReturn（ペインへ戻る）', () => {
    const listEl = mount();
    const onReturn = vi.fn();
    const view = createPlacesView({ listEl, onNavigate: vi.fn(), onReturn });
    view.render(PLACES);
    view.focusFirst();
    key(listEl.querySelectorAll('.place-row')[0], 'Escape');
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('Ctrl 修飾付きキーは無視する（全局トグルを通す）', () => {
    const listEl = mount();
    const onReturn = vi.fn();
    const view = createPlacesView({ listEl, onNavigate: vi.fn(), onReturn });
    view.render(PLACES);
    view.focusFirst();
    const rows = listEl.querySelectorAll('.place-row');
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));
    // Ctrl+j は無視 → フォーカスは動かない
    expect(document.activeElement).toBe(rows[0]);
  });
});
