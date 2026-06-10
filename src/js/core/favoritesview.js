// favoritesview.js — お気に入りサイドバーの描画 (FR-05, FR-06)
// ツリー表示・開閉・ナビゲート・削除・検索（パンくず付き平坦表示）。

/**
 * @param {object} deps
 * @param {HTMLElement} deps.listEl お気に入りを描画する <ul>
 * @param {HTMLInputElement} [deps.searchEl] 検索入力
 * @param {object} deps.favorites favorites モデル
 * @param {(path: string) => void} deps.onNavigate ブックマーク選択時
 * @param {(title: string, def?: string) => Promise<string|null>} [deps.promptName] 名前入力（リネーム用）
 */
export function createFavoritesView(deps) {
  const { listEl, searchEl, favorites, onNavigate, promptName } = deps;
  let query = '';

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
    return li;
  }

  function folderRow(node, depth) {
    const li = document.createElement('li');
    li.className = 'fav-node fav-folder' + (node.open ? ' open' : '');
    const row = document.createElement('div');
    row.className = 'fav-row';
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
    for (const r of results) {
      listEl.appendChild(bookmarkRow(r, 0, r.breadcrumb));
    }
  }

  function render() {
    listEl.replaceChildren();
    if (query.trim()) renderSearch(favorites.search(query));
    else if (favorites.getRoot().length) renderTree(favorites.getRoot(), listEl, 0);
    else {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = 'Ctrl+D で現在地を追加';
      listEl.appendChild(li);
    }
  }

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      query = searchEl.value;
      render();
    });
  }
  const unsubscribe = favorites.subscribe(render);

  return { render, destroy: () => unsubscribe() };
}
