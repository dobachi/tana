// workspaces.js — タブ構成（ワークスペース）の保存/復元の純粋な状態。
//
// 「今開いているタブ群」に名前を付けて保存し、後で一括で開き直す（タブ FR-08 +
// お気に入り FR-05 の合わせ技）。1件は
//   { id, name, left:[dir...], right:[dir...], activeLeft, activeRight, active }
// の形。DOM/Tauri 非依存で、永続化は loadStoredWorkspaces/storeWorkspaces。

const STORAGE_KEY = 'tana.workspaces';

function toDirs(v) {
  return Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : [];
}
function toIndex(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/** 保存データを検証して正規化（不正な項目は捨てる）。 */
function normalize(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it.name !== 'string' || !it.name) continue;
    const left = toDirs(it.left);
    const right = toDirs(it.right);
    if (!left.length && !right.length) continue;
    out.push({
      id: typeof it.id === 'number' ? it.id : 0,
      name: it.name,
      left,
      right,
      activeLeft: toIndex(it.activeLeft),
      activeRight: toIndex(it.activeRight),
      active: it.active === 'right' ? 'right' : 'left',
    });
  }
  return out;
}

export function createWorkspaces(initial = []) {
  let items = normalize(initial);
  let nextId = items.reduce((m, w) => Math.max(m, w.id), 0) + 1;
  // id を振り直して一意にする
  items = items.map((w) => ({ ...w, id: nextId++ }));
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(list()));

  function list() {
    return items.map((w) => ({ ...w, left: [...w.left], right: [...w.right] }));
  }

  /** 同名があれば上書き、無ければ追加。保存した id を返す。 */
  function save(name, snapshot = {}) {
    const clean = {
      name: String(name || '').trim(),
      left: toDirs(snapshot.left),
      right: toDirs(snapshot.right),
      activeLeft: toIndex(snapshot.activeLeft),
      activeRight: toIndex(snapshot.activeRight),
      active: snapshot.active === 'right' ? 'right' : 'left',
    };
    if (!clean.name || (!clean.left.length && !clean.right.length)) return null;
    const existing = items.find((w) => w.name === clean.name);
    if (existing) {
      Object.assign(existing, clean);
      emit();
      return existing.id;
    }
    const id = nextId++;
    items.push({ id, ...clean });
    emit();
    return id;
  }

  function remove(id) {
    const before = items.length;
    items = items.filter((w) => w.id !== id);
    if (items.length !== before) emit();
  }

  function get(id) {
    const w = items.find((x) => x.id === id);
    return w ? { ...w, left: [...w.left], right: [...w.right] } : null;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { list, save, remove, get, subscribe, toJSON: () => list() };
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadStoredWorkspaces(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function storeWorkspaces(items, storage = safeStorage()) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(normalize(items)));
  } catch {
    // プライベートモード等は無視
  }
}
