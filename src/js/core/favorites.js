// favorites.js — お気に入り（ネスト可能なツリー）の真実源 (FR-05, FR-06)
// ノード: { type:'folder', name, open, children[], added? }
//       | { type:'bookmark', name, path, added?, tags? }
// added は登録日時（ms。登録日順の並べ替えに使う。古いデータには無い）、tags は絞り込み用。
// 配列の並びがそのまま「手動の並び」。表示用の並べ替え・まとめは favarrange.js。
// UI 参照用に各ノードへ一時 id を付与（永続化はしない）。

import { parseRemote, remoteLabel } from './remotepath.js';

const STORAGE_KEY = 'tana.favorites';

/**
 * 現在地をお気に入りに入れるときの既定名。末尾の階層名。
 * リモート（`sftp://k16/a/b`, FR-20）は接続先を前に付ける（`k16:b`、ホームは `k16:~`）。
 */
export function defaultBookmarkName(dir) {
  const r = parseRemote(dir);
  if (r) {
    const base = r.path.split('/').filter(Boolean).pop();
    return `${r.host}:${base || (r.path === '/' ? '/' : '~')}`;
  }
  const s = String(dir || '');
  return s.split(/[/\\]/).filter(Boolean).pop() || s;
}

/** お気に入り行のツールチップ（リモートは `k16:/a/b` の短い表記）。 */
export function bookmarkTitle(path) {
  return parseRemote(path) ? remoteLabel(path) : String(path || '');
}

/** 永続化用に id を除いたツリーへ変換 */
export function serialize(nodes) {
  return nodes.map((n) => {
    const out =
      n.type === 'folder'
        ? { type: 'folder', name: n.name, open: n.open, children: serialize(n.children) }
        : { type: 'bookmark', name: n.name, path: n.path };
    if (typeof n.added === 'number') out.added = n.added;
    if (n.type !== 'folder' && n.tags && n.tags.length) out.tags = n.tags.slice();
    return out;
  });
}

/**
 * タグを整える: 前後の空白と先頭の # を落とし、空・重複（大文字小文字を区別しない）を除く。
 * 文字列なら空白・カンマ区切りとして読む。
 * @param {string|string[]} input
 * @returns {string[]}
 */
export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\s,、]+/);
  const out = [];
  const seen = new Set();
  for (const t of list) {
    const tag = String(t == null ? '' : t)
      .trim()
      .replace(/^#+/, '')
      .slice(0, 40);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** ツリー中のタグを重複なく名前順で返す。 */
export function collectTags(nodes) {
  const map = new Map();
  const walk = (list) => {
    for (const n of list) {
      if (n.type === 'folder') walk(n.children);
      else for (const t of n.tags || []) if (!map.has(t.toLowerCase())) map.set(t.toLowerCase(), t);
    }
  };
  walk(nodes);
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
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

/**
 * @param {Array<object>} [initial] 保存済みツリー
 * @param {{now?: () => number}} [opts] now: 登録日時の時計（テスト注入用）
 */
export function createFavorites(initial, opts = {}) {
  const now = opts.now || (() => Date.now());
  let idCounter = 0;
  const makeId = () => `fav-${(idCounter += 1)}`;
  const listeners = new Set();

  function hydrate(nodes) {
    return (Array.isArray(nodes) ? nodes : [])
      .map((n) => {
        const added = n && Number.isFinite(n.added) ? n.added : undefined;
        if (n && n.type === 'folder') {
          return {
            id: makeId(),
            type: 'folder',
            name: String(n.name || 'フォルダ'),
            open: n.open !== false,
            children: hydrate(n.children),
            ...(added !== undefined ? { added } : {}),
          };
        }
        const tags = normalizeTags((n && n.tags) || []);
        return {
          id: makeId(),
          type: 'bookmark',
          name: String((n && n.name) || (n && n.path) || ''),
          path: String((n && n.path) || ''),
          ...(added !== undefined ? { added } : {}),
          ...(tags.length ? { tags } : {}),
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
      if (n.id === id) return { node: n, siblings: parent ? parent.children : root, parent };
      if (n.type === 'folder') {
        const r = locate(id, n.children, n);
        if (r) return r;
      }
    }
    return null;
  }

  function contains(folder, id) {
    for (const c of folder.children) {
      if (c.id === id) return true;
      if (c.type === 'folder' && contains(c, id)) return true;
    }
    return false;
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
      const node = { id: makeId(), type: 'bookmark', name: name || path, path, added: now() };
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
        added: now(),
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

    /** ブックマークのタグを置き換える（文字列なら空白・カンマ区切り）。 */
    setTags(id, tags) {
      const r = locate(id);
      if (!r || r.node.type !== 'bookmark') return false;
      const next = normalizeTags(tags);
      if (next.length) r.node.tags = next;
      else delete r.node.tags;
      emit();
      return true;
    },

    /** ツリー中のタグ一覧（名前順） */
    tags: () => collectTags(root),

    /**
     * 手動の並びを変える: id を targetId の前/後ろ、またはフォルダの中（末尾）へ移す。
     * 自分自身や自分の配下へは移さない。
     * @param {'before'|'after'|'into'} where
     */
    move(id, targetId, where) {
      if (id === targetId) return false;
      const src = locate(id);
      const dst = locate(targetId);
      if (!src || !dst) return false;
      if (src.node.type === 'folder' && contains(src.node, targetId)) return false;
      if (where === 'into' && dst.node.type !== 'folder') return false;
      src.siblings.splice(src.siblings.indexOf(src.node), 1);
      if (where === 'into') {
        dst.node.children.push(src.node);
        dst.node.open = true;
      } else {
        const i = dst.siblings.indexOf(dst.node);
        dst.siblings.splice(where === 'after' ? i + 1 : i, 0, src.node);
      }
      emit();
      return true;
    },

    /** 同じ階層の中で前後へ delta 個ずらす（端では止まる）。 */
    moveBy(id, delta) {
      const r = locate(id);
      if (!r) return false;
      const i = r.siblings.indexOf(r.node);
      const j = Math.max(0, Math.min(r.siblings.length - 1, i + delta));
      if (i === j) return false;
      r.siblings.splice(i, 1);
      r.siblings.splice(j, 0, r.node);
      emit();
      return true;
    },

    /** 直前の兄弟フォルダの中（末尾）へ入れる。 */
    indent(id) {
      const r = locate(id);
      if (!r) return false;
      const i = r.siblings.indexOf(r.node);
      const prev = r.siblings[i - 1];
      if (!prev || prev.type !== 'folder') return false;
      r.siblings.splice(i, 1);
      prev.children.push(r.node);
      prev.open = true;
      emit();
      return true;
    },

    /** 入っているフォルダから出し、そのフォルダの直後へ置く。 */
    outdent(id) {
      const r = locate(id);
      if (!r || !r.parent) return false;
      const up = locate(r.parent.id);
      r.siblings.splice(r.siblings.indexOf(r.node), 1);
      up.siblings.splice(up.siblings.indexOf(up.node) + 1, 0, r.node);
      emit();
      return true;
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
