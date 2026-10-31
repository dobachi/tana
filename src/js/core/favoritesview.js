// favoritesview.js — お気に入りサイドバーの描画 + キーボード/ドラッグ操作 (FR-05, FR-06)
// ツリー表示・開閉・ナビゲート・削除・検索（パンくず付き平坦表示）。
// 見せ方（並べ替え・まとめ方・タグの絞り込み）は favarrange.js（純粋）で作る。
// キーボード: j/k 移動, Enter/l 開く, h 閉じる, t タグ編集, Esc/Tab でペインへ戻る。
//   手動の並びのとき: Alt+↑/↓ 前後へ、Alt+→ 直前のフォルダへ入れる、Alt+← フォルダから出す。
// ドラッグ: 手動の並びのとき行を掴んで前後へ、フォルダの中央へ落とすとその中へ。
//   HTML5 D&D は Tauri の OS ドロップと排他なのでポインタイベントで自作する（dragdrop.js と同じ理由）。

import { bookmarkTitle } from './favorites.js';
import { remoteHost } from './remotepath.js';
import {
  createFavViewState,
  sortTree,
  sortFlat,
  parseQuery,
  matchesQuery,
  flatten,
  groupTree,
  dropPosition,
  describeView,
} from './favarrange.js';

const DRAG_THRESHOLD = 5;
const MANUAL_ONLY = '並べ替えが「手動」のときだけ動かせます（⇅ で切替）';
const FILTERED = '絞り込み中は動かせません';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.listEl お気に入りを描画する <ul>
 * @param {HTMLInputElement} [deps.searchEl] 検索入力（`#タグ` でタグ絞り込み）
 * @param {HTMLElement} [deps.tagsEl] タグのチップを並べる入れ物
 * @param {HTMLElement} [deps.optionsBtn] 「並べ替え・まとめ方」メニューを開くボタン
 * @param {object} deps.favorites favorites モデル
 * @param {object} [deps.viewState] 表示設定（favarrange.createFavViewState）
 * @param {(path: string) => void} deps.onNavigate ブックマーク選択時
 * @param {() => void} [deps.onReturn] サイドバーからペインへ戻るとき（Esc/Tab）
 * @param {(title: string, def?: string) => Promise<string|null>} [deps.promptName] 名前入力
 * @param {(x: number, y: number, items: Array<object>) => void} [deps.showMenu] ドロップダウン
 * @param {(msg: string) => void} [deps.notify] 一言の案内（トースト）
 * @param {(x: number, y: number) => Element|null} [deps.hitTest] 座標の要素（テスト注入用）
 */
export function createFavoritesView(deps) {
  const {
    listEl,
    searchEl,
    tagsEl,
    optionsBtn,
    favorites,
    viewState = createFavViewState(),
    onNavigate,
    onReturn,
    promptName,
    showMenu,
    notify = () => {},
    hitTest = (x, y) => (document.elementFromPoint ? document.elementFromPoint(x, y) : null),
  } = deps;
  let query = '';
  let navRows = []; // [{ el, node, kind }] 表示順。kind: 'bookmark' | 'folder' | 'group'
  let focusIdx = -1;
  let focusNodeId = null;
  let hasFocus = false;

  const view = () => viewState.get();
  const isManual = () => view().sort === 'manual';
  const isFiltered = () => !!query.trim() || !!activeTag();

  /** 選択中のタグ（もう誰も持っていなければ無効） */
  function activeTag() {
    const t = view().tag;
    if (!t) return null;
    return favorites.tags().some((x) => x.toLowerCase() === t.toLowerCase()) ? t : null;
  }

  function makeRemove(id) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fav-remove';
    b.textContent = '×';
    b.title = '削除';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      favorites.remove(id);
    });
    return b;
  }

  async function editTags(node) {
    if (!promptName || node.type !== 'bookmark') return;
    const cur = (favorites.find(node.id) || node).tags || [];
    const v = await promptName('タグ（空白区切り。空欄で外す）', cur.join(' '));
    if (v != null) favorites.setTags(node.id, v);
  }

  function bookmarkRow(node, depth, breadcrumb) {
    const li = document.createElement('li');
    li.className = 'fav-node fav-bookmark';
    const row = document.createElement('div');
    row.className = 'fav-row';
    row.tabIndex = -1;
    row.dataset.id = node.id;
    row.style.paddingLeft = `${8 + depth * 12}px`;
    const tags = node.tags || [];
    row.title =
      bookmarkTitle(node.path) + (tags.length ? `\n${tags.map((t) => `#${t}`).join(' ')}` : '');

    // リモート（FR-20）は 🌐 と接続先で見分ける
    const host = remoteHost(node.path);
    if (host) {
      li.classList.add('fav-remote');
      const mark = document.createElement('span');
      mark.className = 'fav-remote-mark';
      mark.textContent = '🌐';
      mark.title = host;
      row.appendChild(mark);
    }

    const name = document.createElement('span');
    name.className = 'fav-name';
    name.textContent = node.name;
    row.appendChild(name);

    if (breadcrumb && breadcrumb.length) {
      const bc = document.createElement('span');
      bc.className = 'fav-breadcrumb';
      bc.textContent = breadcrumb.join(' / ');
      row.appendChild(bc);
    }

    row.appendChild(makeRemove(node.id));
    row.addEventListener('click', () => onNavigate(node.path));
    if (promptName) {
      row.addEventListener('dblclick', async (e) => {
        e.preventDefault();
        const n = await promptName('お気に入りの名前', node.name);
        if (n && n.trim()) favorites.rename(node.id, n.trim());
      });
    }
    li.appendChild(row);
    navRows.push({ el: row, node, kind: 'bookmark' });
    return li;
  }

  function folderRow(node, depth) {
    const li = document.createElement('li');
    li.className = 'fav-node fav-folder' + (node.open ? ' open' : '');
    const row = document.createElement('div');
    row.className = 'fav-row';
    row.tabIndex = -1;
    row.dataset.id = node.id;
    row.style.paddingLeft = `${8 + depth * 12}px`;

    const caret = document.createElement('span');
    caret.className = 'fav-caret';
    row.appendChild(caret);

    const name = document.createElement('span');
    name.className = 'fav-name';
    name.textContent = node.name;
    row.appendChild(name);

    row.appendChild(makeRemove(node.id));
    row.addEventListener('click', () => favorites.toggleOpen(node.id));
    if (promptName) {
      row.addEventListener('dblclick', async (e) => {
        e.preventDefault();
        const n = await promptName('フォルダ名', node.name);
        if (n && n.trim()) favorites.rename(node.id, n.trim());
      });
    }
    li.appendChild(row);
    navRows.push({ el: row, node, kind: 'folder' });

    if (node.open && node.children.length) {
      const ul = document.createElement('ul');
      ul.className = 'fav-children';
      renderTree(node.children, ul, depth + 1);
      li.appendChild(ul);
    }
    return li;
  }

  /** まとめ方の見出し（接続先・タグ）。たためる。 */
  function groupRow(group) {
    const collapsed = viewState.isCollapsed(group.key);
    const li = document.createElement('li');
    li.className = 'fav-node fav-group' + (collapsed ? '' : ' open');
    const row = document.createElement('div');
    row.className = 'fav-row fav-group-row';
    row.tabIndex = -1;
    row.dataset.key = group.key;
    const caret = document.createElement('span');
    caret.className = 'fav-caret';
    row.appendChild(caret);
    const name = document.createElement('span');
    name.className = 'fav-name';
    name.textContent = group.label;
    row.appendChild(name);
    const count = document.createElement('span');
    count.className = 'fav-count';
    count.textContent = String(group.count);
    row.appendChild(count);
    row.addEventListener('click', () => viewState.toggleCollapsed(group.key));
    li.appendChild(row);
    navRows.push({ el: row, node: { id: `group:${group.key}`, key: group.key }, kind: 'group' });
    if (!collapsed) {
      const ul = document.createElement('ul');
      ul.className = 'fav-children';
      renderTree(sortTree(group.nodes, view()), ul, 1);
      li.appendChild(ul);
    }
    return li;
  }

  function renderTree(nodes, container, depth) {
    for (const node of nodes) {
      container.appendChild(
        node.type === 'folder' ? folderRow(node, depth) : bookmarkRow(node, depth),
      );
    }
  }

  function placeholder(text) {
    const li = document.createElement('li');
    li.className = 'placeholder';
    li.textContent = text;
    listEl.appendChild(li);
  }

  function renderFiltered() {
    const q = parseQuery(query);
    const tag = activeTag();
    const items = sortFlat(
      flatten(favorites.getRoot(), (n) => matchesQuery(n, q, tag)),
      view(),
    );
    if (!items.length) {
      placeholder('見つかりません');
      return;
    }
    for (const it of items) listEl.appendChild(bookmarkRow(it.node, 0, it.breadcrumb));
  }

  function renderTags() {
    if (!tagsEl) return;
    tagsEl.replaceChildren();
    const tags = favorites.tags();
    tagsEl.hidden = tags.length === 0;
    const cur = activeTag();
    for (const t of tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fav-tag';
      const on = !!cur && cur.toLowerCase() === t.toLowerCase();
      if (on) chip.classList.add('active');
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      chip.textContent = `#${t}`;
      chip.dataset.tag = t;
      chip.title = on ? '絞り込みを外す' : `#${t} で絞り込む`;
      chip.addEventListener('click', () => viewState.update({ tag: on ? null : t }));
      tagsEl.appendChild(chip);
    }
  }

  function render() {
    listEl.replaceChildren();
    navRows = [];
    renderTags();
    if (optionsBtn) {
      optionsBtn.title = `並べ替え・まとめ方（${describeView(view())}）`;
      optionsBtn.classList.toggle('active', !isManual() || view().group !== 'none');
    }
    const root = favorites.getRoot();
    if (isFiltered()) renderFiltered();
    else if (!root.length) placeholder('Ctrl+D で現在地を追加');
    else if (view().group !== 'none') {
      for (const g of groupTree(root, view().group)) listEl.appendChild(groupRow(g));
      // まとめると、ブックマークの無いフォルダは見出しの下に出ない
      if (!navRows.length) placeholder('（まとめ方「なし」でフォルダを表示）');
    } else renderTree(sortTree(root, view()), listEl, 0);
    // フォーカス中なら同じノード（無ければ近い位置）へ復帰
    if (hasFocus && navRows.length) {
      let i = focusNodeId != null ? navRows.findIndex((r) => r.node.id === focusNodeId) : -1;
      if (i < 0) i = Math.min(Math.max(focusIdx, 0), navRows.length - 1);
      setFocus(i);
    }
  }

  function setFocus(i) {
    if (!navRows.length) return;
    focusIdx = Math.max(0, Math.min(i, navRows.length - 1));
    focusNodeId = navRows[focusIdx].node.id;
    navRows[focusIdx].el.focus();
  }

  /** サイドバーへフォーカスを移す（空なら検索欄） */
  function focusFirst() {
    if (navRows.length) setFocus(0);
    else if (searchEl) searchEl.focus();
  }

  /** 並べ替えてよい状態か。だめなら理由を案内して false。 */
  function canReorder() {
    if (!isManual()) {
      notify(MANUAL_ONLY);
      return false;
    }
    if (isFiltered()) {
      notify(FILTERED);
      return false;
    }
    return true;
  }

  /** 上へ・下へで並べ替えられる状態か（案内は出さない。右クリックメニューの有効/無効用） */
  const reorderAllowed = () => isManual() && !isFiltered();

  const MOVES = {
    ArrowUp: (id) => favorites.moveBy(id, -1),
    ArrowDown: (id) => favorites.moveBy(id, 1),
    ArrowRight: (id) => favorites.indent(id),
    ArrowLeft: (id) => favorites.outdent(id),
  };

  function onKey(e) {
    if (!navRows.length) return;
    let idx = navRows.findIndex((r) => r.el === document.activeElement);
    if (idx < 0) idx = focusIdx >= 0 ? focusIdx : 0;
    const r = navRows[idx];
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      // 手動の並べ替え。それ以外の Alt+文字 はメニューのアクセスキーへ通す
      if (!MOVES[e.key]) return;
      e.preventDefault();
      e.stopPropagation();
      if (r.kind !== 'group' && canReorder()) {
        focusNodeId = r.node.id;
        MOVES[e.key](r.node.id);
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) return; // 全局トグルは通す
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setFocus(idx + 1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setFocus(idx - 1);
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        r.el.click();
        break;
      case 'l':
        e.preventDefault();
        e.stopPropagation();
        if (r.kind === 'folder') {
          if (!r.node.open) favorites.toggleOpen(r.node.id);
        } else if (r.kind === 'group') {
          if (viewState.isCollapsed(r.node.key)) viewState.toggleCollapsed(r.node.key);
        } else r.el.click();
        break;
      case 'h':
        e.preventDefault();
        e.stopPropagation();
        if (r.kind === 'folder' && r.node.open) favorites.toggleOpen(r.node.id);
        else if (r.kind === 'group' && !viewState.isCollapsed(r.node.key)) {
          viewState.toggleCollapsed(r.node.key);
        }
        break;
      case 't':
        e.preventDefault();
        e.stopPropagation();
        if (r.kind === 'bookmark') editTags(r.node);
        break;
      case 'Tab':
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (onReturn) onReturn();
        break;
      default:
        break;
    }
  }

  // ===== ドラッグで並べ替え（手動の並びのときだけ） =====
  let drag = null; // { id, row, x, y, active, target, where }
  let swallowClick = false;

  function clearDropMarks() {
    for (const el of listEl.querySelectorAll('.fav-drop-before, .fav-drop-after, .fav-drop-into')) {
      el.classList.remove('fav-drop-before', 'fav-drop-after', 'fav-drop-into');
    }
  }

  function endDrag() {
    if (!drag) return;
    clearDropMarks();
    if (drag.row) drag.row.classList.remove('fav-dragging');
    document.removeEventListener('pointermove', onDragMove, true);
    document.removeEventListener('pointerup', onDragEnd, true);
    document.removeEventListener('keydown', onDragKey, true);
    drag = null;
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
      if (!canReorder()) {
        endDrag();
        return;
      }
      drag.active = true;
      drag.row.classList.add('fav-dragging');
    }
    clearDropMarks();
    drag.target = null;
    const hit = hitTest(e.clientX, e.clientY);
    const row = hit && hit.closest ? hit.closest('.fav-row') : null;
    if (!row || !listEl.contains(row) || !row.dataset.id || row.dataset.id === drag.id) return;
    const node = favorites.find(row.dataset.id);
    if (!node) return;
    const rect = row.getBoundingClientRect();
    const where = dropPosition(e.clientY - rect.top, rect.height, node.type === 'folder');
    drag.target = node.id;
    drag.where = where;
    row.classList.add(`fav-drop-${where}`);
  }

  function onDragEnd() {
    if (!drag) return;
    const { active, id, target, where } = drag;
    endDrag();
    if (!active) return;
    swallowClick = true; // 掴んで離した行のクリック（移動・開閉）を起こさない
    setTimeout(() => {
      swallowClick = false;
    }, 0);
    if (target) {
      focusNodeId = id;
      favorites.move(id, target, where);
    }
  }

  function onDragKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endDrag();
    }
  }

  listEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const row = e.target.closest ? e.target.closest('.fav-row') : null;
    if (!row || !row.dataset.id || e.target.closest('.fav-remove')) return;
    drag = { id: row.dataset.id, row, x: e.clientX, y: e.clientY, active: false, target: null };
    document.addEventListener('pointermove', onDragMove, true);
    document.addEventListener('pointerup', onDragEnd, true);
    document.addEventListener('keydown', onDragKey, true);
  });
  listEl.addEventListener(
    'click',
    (e) => {
      if (swallowClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  // ===== 並べ替え・まとめ方メニュー =====
  function optionItems() {
    const v = view();
    const item = (on, label, patch, disabled = false) => ({
      label: `${on ? '✓' : '　'} ${label}`,
      disabled,
      action: () => viewState.update(patch),
    });
    const auto = v.sort !== 'manual';
    return [
      item(v.sort === 'manual', '手動（ドラッグ / Alt+↑↓）', { sort: 'manual' }),
      item(v.sort === 'name', '名前順', { sort: 'name' }),
      item(v.sort === 'added', '登録日順', { sort: 'added' }),
      { separator: true },
      item(auto && v.order === 'asc', '昇順', { order: 'asc' }, !auto),
      item(auto && v.order === 'desc', '降順', { order: 'desc' }, !auto),
      { separator: true },
      item(v.group === 'none', 'まとめない', { group: 'none' }),
      item(v.group === 'host', '接続先でまとめる', { group: 'host' }),
      item(v.group === 'tag', 'タグでまとめる', { group: 'tag' }),
    ];
  }

  if (optionsBtn && showMenu) {
    optionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = optionsBtn.getBoundingClientRect();
      showMenu(r.left, r.bottom, optionItems());
    });
  }

  listEl.addEventListener('keydown', onKey);
  listEl.addEventListener('focusin', () => {
    hasFocus = true;
  });
  listEl.addEventListener('focusout', (e) => {
    if (!listEl.contains(e.relatedTarget)) hasFocus = false;
  });

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      query = searchEl.value;
      render();
    });
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onReturn) onReturn();
      }
    });
  }

  const unsubscribe = favorites.subscribe(render);
  const unsubView = viewState.subscribe(render);

  return {
    render,
    focusFirst,
    optionItems,
    reorderAllowed,
    editTags: (id) => {
      const node = favorites.find(id);
      if (node) editTags(node);
    },
    /** 表示中のまとめ見出しのキー（すべてたたむ / 開く 用） */
    groupKeys: () => navRows.filter((r) => r.kind === 'group').map((r) => r.node.key),
    isFocused: () => hasFocus,
    destroy: () => {
      unsubscribe();
      unsubView();
      endDrag();
    },
  };
}
