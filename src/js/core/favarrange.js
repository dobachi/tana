// favarrange.js — お気に入りの「見せ方」(FR-05, FR-06, FR-20)。純粋・DOM 非依存。
//
// 保存されたツリー（favorites.js）の並びが「手動の並び」。ここではそれを壊さずに、
//   - 自動の並べ替え（名前順 / 登録日順 × 昇順 / 降順。フォルダは先頭にまとめる）
//   - まとめ方（なし / 接続先ごと / タグごと。見出しはたためる）
//   - 絞り込み（検索語と #タグ、タグのチップ）
// を表示用のコピーとして作る。設定（表示の状態）もここで持ち、localStorage へ保存する。

import { remoteHost } from './remotepath.js';

export const VIEW_KEY = 'tana.favorites.view';
export const SORTS = ['manual', 'name', 'added'];
export const ORDERS = ['asc', 'desc'];
export const GROUPS = ['none', 'host', 'tag'];
export const DEFAULT_VIEW = Object.freeze({
  sort: 'manual',
  order: 'asc',
  group: 'none',
  tag: null,
  collapsed: [],
});

/** 保存された表示設定を検証して既定で埋める。 */
export function sanitizeView(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    sort: SORTS.includes(o.sort) ? o.sort : DEFAULT_VIEW.sort,
    order: ORDERS.includes(o.order) ? o.order : DEFAULT_VIEW.order,
    group: GROUPS.includes(o.group) ? o.group : DEFAULT_VIEW.group,
    tag: typeof o.tag === 'string' && o.tag ? o.tag : null,
    collapsed: Array.isArray(o.collapsed)
      ? [...new Set(o.collapsed.filter((k) => typeof k === 'string'))]
      : [],
  };
}

/**
 * 表示設定の状態。変更は購読者へ通知する（app が保存し、view が描き直す）。
 * @param {object} [initial]
 */
export function createFavViewState(initial) {
  let view = sanitizeView(initial);
  const subs = new Set();
  const emit = () => subs.forEach((f) => f(view));
  return {
    get: () => view,
    update(patch) {
      view = sanitizeView({ ...view, ...patch });
      emit();
    },
    isCollapsed: (key) => view.collapsed.includes(key),
    toggleCollapsed(key) {
      const has = view.collapsed.includes(key);
      view = sanitizeView({
        ...view,
        collapsed: has ? view.collapsed.filter((k) => k !== key) : [...view.collapsed, key],
      });
      emit();
      return !has;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    toJSON: () => ({ ...view, collapsed: view.collapsed.slice() }),
    /** 丸ごと置き換える（別ウィンドウの変更を取り込む）。同じ内容なら何もしない */
    replace(next) {
      const v = sanitizeView(next);
      if (JSON.stringify(v) === JSON.stringify(view)) return;
      view = v;
      emit();
    },
  };
}

export function loadFavView(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(VIEW_KEY);
    return sanitizeView(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeView(null);
  }
}

export function storeFavView(view, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // 保存できなくても表示は続ける
  }
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

function comparator(sort, order) {
  const dir = order === 'desc' ? -1 : 1;
  if (sort === 'name') return (a, b) => dir * collator.compare(a.name, b.name);
  // 登録日時の無い古いデータは「最も古い」扱い
  const t = (n) => (Number.isFinite(n.added) ? n.added : -Infinity);
  return (a, b) => {
    const d = t(a) - t(b);
    return dir * (Number.isNaN(d) ? 0 : d);
  };
}

/**
 * 表示用に並べ替えたツリーを返す（元のツリーは変えない）。
 * 手動ならそのまま。自動ならフォルダを先頭にまとめ、それぞれを並べ、配下も同様に並べる。
 * @param {Array<object>} nodes
 * @param {{sort: string, order: string}} view
 */
export function sortTree(nodes, view) {
  if (!view || view.sort === 'manual') return nodes;
  const cmp = comparator(view.sort, view.order);
  const folders = nodes
    .filter((n) => n.type === 'folder')
    .map((n) => ({ ...n, children: sortTree(n.children, view) }));
  const marks = nodes.filter((n) => n.type !== 'folder');
  return [...folders.sort(cmp), ...marks.sort(cmp)];
}

/** 平坦な検索結果（{node, breadcrumb}）を並べる。手動ならツリー順のまま。 */
export function sortFlat(items, view) {
  if (!view || view.sort === 'manual') return items;
  const cmp = comparator(view.sort, view.order);
  return items.slice().sort((a, b) => cmp(a.node, b.node));
}

/**
 * 検索欄の文字列を語とタグに分ける。`#仕事 提案` → { text: '提案', tags: ['仕事'] }
 * @returns {{text: string, tags: string[]}}
 */
export function parseQuery(q) {
  const words = String(q || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const tags = [];
  const text = [];
  for (const w of words) {
    if (w.startsWith('#') && w.length > 1) tags.push(w.slice(1).toLowerCase());
    else text.push(w.toLowerCase());
  }
  return { text: text.join(' '), tags };
}

/** ブックマークが検索語（名前・パス）とタグ（すべて含む）に合うか。 */
export function matchesQuery(node, query, extraTag = null) {
  if (node.type === 'folder') return false;
  const own = (node.tags || []).map((t) => t.toLowerCase());
  const want = extraTag ? [...query.tags, extraTag.toLowerCase()] : query.tags;
  if (!want.every((t) => own.includes(t))) return false;
  if (!query.text) return true;
  return query.text
    .split(' ')
    .every((w) => node.name.toLowerCase().includes(w) || node.path.toLowerCase().includes(w));
}

/** 条件に合うブックマークを、所属フォルダのパンくず付きでツリー順に平坦化する。 */
export function flatten(nodes, pred, trail = []) {
  let out = [];
  for (const n of nodes) {
    if (n.type === 'folder') out = out.concat(flatten(n.children, pred, [...trail, n.name]));
    else if (pred(n)) out.push({ node: n, breadcrumb: trail });
  }
  return out;
}

/** 条件に合うブックマークだけを残したツリー（空になったフォルダは消す）。 */
export function pruneTree(nodes, pred) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'folder') {
      const children = pruneTree(n.children, pred);
      if (children.length) out.push({ ...n, children });
    } else if (pred(n)) out.push(n);
  }
  return out;
}

export const LOCAL_GROUP = 'local';
export const NO_TAG_GROUP = 'notag';

function groupKeysOf(node, mode) {
  if (mode === 'host') {
    const h = remoteHost(node.path);
    return [h ? `host:${h}` : LOCAL_GROUP];
  }
  const tags = node.tags || [];
  return tags.length ? tags.map((t) => `tag:${t.toLowerCase()}`) : [NO_TAG_GROUP];
}

/**
 * まとめ方に応じて見出しごとのツリーへ分ける。各見出しの下はフォルダ構造を保つ
 * （そのグループのブックマークを含むフォルダだけ残る）。
 * - host: 「このPC」→ 接続先（名前順）
 * - tag : タグ（名前順。複数タグのものは各見出しに出る）→「タグなし」
 * @returns {Array<{key: string, label: string, nodes: Array<object>, count: number}>}
 */
export function groupTree(nodes, mode) {
  if (mode !== 'host' && mode !== 'tag') return [];
  const labels = new Map();
  const walk = (list) => {
    for (const n of list) {
      if (n.type === 'folder') {
        walk(n.children);
        continue;
      }
      if (mode === 'host') {
        const h = remoteHost(n.path);
        labels.set(h ? `host:${h}` : LOCAL_GROUP, h || 'このPC');
      } else if ((n.tags || []).length) {
        for (const t of n.tags) {
          const k = `tag:${t.toLowerCase()}`;
          if (!labels.has(k)) labels.set(k, `#${t}`);
        }
      } else labels.set(NO_TAG_GROUP, 'タグなし');
    }
  };
  walk(nodes);
  const keys = [...labels.keys()].sort((a, b) => {
    const rank = (k) => (k === LOCAL_GROUP ? 0 : k === NO_TAG_GROUP ? 2 : 1);
    return rank(a) - rank(b) || collator.compare(labels.get(a), labels.get(b));
  });
  return keys.map((key) => {
    const pred = (n) => groupKeysOf(n, mode).includes(key);
    return {
      key,
      label: labels.get(key),
      nodes: pruneTree(nodes, pred),
      count: flatten(nodes, pred).length,
    };
  });
}

/**
 * ドラッグ中、行のどこにいるかで落とし方を決める。
 * フォルダは上 1/4 = 前、下 1/4 = 後ろ、中央 = 中へ。ブックマークは上半分 = 前、下半分 = 後ろ。
 * @param {number} offsetY 行の上端からの位置
 * @param {number} height 行の高さ
 * @param {boolean} isFolder
 * @returns {'before'|'after'|'into'}
 */
export function dropPosition(offsetY, height, isFolder) {
  if (!(height > 0)) return 'after';
  const r = offsetY / height;
  if (isFolder) {
    if (r < 0.25) return 'before';
    if (r > 0.75) return 'after';
    return 'into';
  }
  return r < 0.5 ? 'before' : 'after';
}

/** 「並べ替え・まとめ方」メニューの説明（ステータス・ツールチップ用）。 */
export function describeView(view) {
  const v = sanitizeView(view);
  const sort = { manual: '手動', name: '名前順', added: '登録日順' }[v.sort];
  const order = v.sort === 'manual' ? '' : v.order === 'asc' ? '・昇順' : '・降順';
  const group = { none: '', host: ' / 接続先でまとめる', tag: ' / タグでまとめる' }[v.group];
  return `${sort}${order}${group}`;
}
