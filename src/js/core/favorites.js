// favorites.js — お気に入り（ネスト可能なツリー）の真実源 (FR-05, FR-06)
// ノード: { type:'folder', name, open, children[] } | { type:'bookmark', name, path }
// UI 参照用に各ノードへ一時 id を付与（永続化はしない）。

const STORAGE_KEY = 'tana.favorites';

/** 永続化用に id を除いたツリーへ変換 */
export function serialize(nodes) {
  return nodes.map((n) =>
    n.type === 'folder'
      ? { type: 'folder', name: n.name, open: n.open, children: serialize(n.children) }
      : { type: 'bookmark', name: n.name, path: n.path },
  );
}

/** name / path に query を含むブックマークを、所属フォルダのパンくず付きで平坦に返す (FR-06) */
export function searchTree(nodes, query, trail = []) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  let results = [];
  for (const n of nodes) {
    if (n.type === 'folder') {
      results = results.concat(searchTree(n.children, query, [...trail, n.name]));
    } else if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) {
      results.push({ id: n.id, name: n.name, path: n.path, breadcrumb: trail });
    }
  }
  return results;
}

export function createFavorites(initial) {
  let idCounter = 0;
  const makeId = () => `fav-${(idCounter += 1)}`;
  const listeners = new Set();

  function hydrate(nodes) {
    return (Array.isArray(nodes) ? nodes : [])
      .map((n) => {
        if (n && n.type === 'folder') {
          return {
            id: makeId(),
            type: 'folder',
            name: String(n.name || 'フォルダ'),
            open: n.open !== false,
            children: hydrate(n.children),
          };
        }
        return {
          id: makeId(),
          type: 'bookmark',
          name: String((n && n.name) || (n && n.path) || ''),
          path: String((n && n.path) || ''),
        };
      })
      .filter((n) => n.type === 'folder' || n.path);
  }

  let root = hydrate(initial);

  function emit() {
    for (const fn of listeners) fn(root);
  }

  function locate(id, nodes = root, parent = null) {
    for (const n of nodes) {
      if (n.id === id) return { node: n, siblings: parent ? parent.children : root };
      if (n.type === 'folder') {
        const r = locate(id, n.children, n);
        if (r) return r;
      }
    }
    return null;
  }

  function containerFor(parentId) {
    if (!parentId) return root;
    const r = locate(parentId);
    return r && r.node.type === 'folder' ? r.node.children : root;
  }

  return {
    getRoot: () => root,

    /** ブックマークを追加（親フォルダ id 省略でルート） */
    addBookmark(name, path, parentId = null) {
      if (!path) return null;
      const node = { id: makeId(), type: 'bookmark', name: name || path, path };
      containerFor(parentId).push(node);
      emit();
      return node.id;
    },

    /** フォルダを追加 */
    addFolder(name, parentId = null) {
      const node = {
        id: makeId(),
        type: 'folder',
        name: name || 'フォルダ',
        open: true,
        children: [],
      };
      containerFor(parentId).push(node);
      emit();
      return node.id;
    },

    /** ノードを削除（フォルダは配下ごと） */
    remove(id) {
      const r = locate(id);
      if (!r) return false;
      const i = r.siblings.indexOf(r.node);
      if (i < 0) return false;
      r.siblings.splice(i, 1);
      emit();
      return true;
    },

    /** 名前を変更 */
    rename(id, name) {
      const r = locate(id);
      if (!r || !name) return false;
      r.node.name = name;
      emit();
      return true;
    },

    /** フォルダの開閉トグル */
    toggleOpen(id) {
      const r = locate(id);
      if (!r || r.node.type !== 'folder') return null;
      r.node.open = !r.node.open;
      emit();
      return r.node.open;
    },

    find: (id) => {
      const r = locate(id);
      return r ? r.node : null;
    },
    search: (query) => searchTree(root, query),
    toJSON: () => serialize(root),
    subscribe(fn) {
      listeners.add(fn);
      fn(root);
      return () => listeners.delete(fn);
    },
  };
}

/** 保存済みお気に入りを読み込む */
export function loadStoredFavorites() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** お気に入りを永続化する */
export function storeFavorites(tree) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
  } catch {
    /* localStorage 不在時は無視 */
  }
}
