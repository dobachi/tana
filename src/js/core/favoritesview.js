// favoritesview.js — お気に入りサイドバーの描画 + キーボード操作 (FR-05, FR-06)
// ツリー表示・開閉・ナビゲート・削除・検索（パンくず付き平坦表示）。
// キーボード: j/k 移動, Enter/l 開く, h 閉じる, Esc/Tab でペインへ戻る。

/**
 * @param {object} deps
 * @param {HTMLElement} deps.listEl お気に入りを描画する <ul>
 * @param {HTMLInputElement} [deps.searchEl] 検索入力
 * @param {object} deps.favorites favorites モデル
 * @param {(path: string) => void} deps.onNavigate ブックマーク選択時
 * @param {() => void} [deps.onReturn] サイドバーからペインへ戻るとき（Esc/Tab）
 * @param {(title: string, def?: string) => Promise<string|null>} [deps.promptName] 名前入力
 */
export function createFavoritesView(deps) {
  const { listEl, searchEl, favorites, onNavigate, onReturn, promptName } = deps;
  let query = '';
  let navRows = []; // [{ el, node, kind }] 表示順
  let focusIdx = -1;
  let focusNodeId = null;
  let hasFocus = false;

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

  function bookmarkRow(node, depth, breadcrumb) {
    const li = document.createElement('li');
    li.className = 'fav-node fav-bookmark';
    const row = document.createElement('div');
    row.className = 'fav-row';
    row.tabIndex = -1;
    row.style.paddingLeft = `${8 + depth * 12}px`;
    row.title = node.path;

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

  function renderTree(nodes, container, depth) {
    for (const node of nodes) {
      container.appendChild(
        node.type === 'folder' ? folderRow(node, depth) : bookmarkRow(node, depth),
      );
    }
  }

  function renderSearch(results) {
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '見つかりません';
      listEl.appendChild(li);
      return;
    }
    for (const r of results) listEl.appendChild(bookmarkRow(r, 0, r.breadcrumb));
  }

  function render() {
    listEl.replaceChildren();
    navRows = [];
    if (query.trim()) renderSearch(favorites.search(query));
    else if (favorites.getRoot().length) renderTree(favorites.getRoot(), listEl, 0);
    else {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = 'Ctrl+D で現在地を追加';
      listEl.appendChild(li);
    }
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

  function onKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return; // 全局トグルは通す
    if (!navRows.length) return;
    let idx = navRows.findIndex((r) => r.el === document.activeElement);
    if (idx < 0) idx = focusIdx >= 0 ? focusIdx : 0;
    const r = navRows[idx];
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
        } else r.el.click();
        break;
      case 'h':
        e.preventDefault();
        e.stopPropagation();
        if (r.kind === 'folder' && r.node.open) favorites.toggleOpen(r.node.id);
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

  return { render, focusFirst, isFocused: () => hasFocus, destroy: () => unsubscribe() };
}
