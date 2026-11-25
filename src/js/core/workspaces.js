// workspaces.js — 名前付きワークスペース。それぞれが自分のセッション（各ペインの場所・
// タブ・アクティブペイン）を持ち、どれを保存するかもワークスペースごとに選べる。
//
// 使用中のワークスペースのセッションは、通常のセッション保存 (FR-14) のたびに
// record() で書き込まれる（自動保存）。切り替えると今のセッションを残し、相手の
// セッションを両ペインへ広げる（app.js）。
//
// 以前の版の「タブ構成に名前を付けて保存するスナップショット」の配列も読める。
// その各項目は同名のワークスペースになり、それまでの単一セッションは "default" になる。
//
// 保存形 (localStorage 'tana.workspaces'):
//   { active: "default",
//     items: [{ name, keep: {dirs, tabs, active_pane}, session }] }
// session は session.js の形 { dirs, active, tabs, activeTab }。
// DOM/Tauri 非依存。

const STORAGE_KEY = 'tana.workspaces';

export const DEFAULT_WORKSPACE = 'default';

/** 保存するかを選べる項目（設定に並べる順）。 */
export const KEEP_ITEMS = [
  { key: 'dirs', label: '各ペインの場所' },
  { key: 'tabs', label: 'タブ（オフならアクティブなタブだけ）' },
  { key: 'active_pane', label: 'アクティブなペイン' },
];

const MAX_NAME = 64;

/** 全部保存する（既定。項目が増える前のワークスペースもこれ）。 */
export function defaultKeep() {
  return Object.fromEntries(KEEP_ITEMS.map(({ key }) => [key, true]));
}

/** false 以外（欠け・不正値）は「保存する」扱い。 */
export function normalizeKeep(keep) {
  const k = keep && typeof keep === 'object' ? keep : {};
  return Object.fromEntries(KEEP_ITEMS.map(({ key }) => [key, k[key] !== false]));
}

function str(v) {
  return typeof v === 'string' && v ? v : null;
}
function dirList(v) {
  if (!Array.isArray(v)) return null;
  const l = v.filter((p) => typeof p === 'string' && p);
  return l.length ? l : null;
}
function index(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}
function side(v) {
  return v === 'right' ? 'right' : 'left';
}

/** セッションを検証して正規化（session.js の loadSession と同じ形）。不正なら null。 */
export function cleanSession(o) {
  if (!o || typeof o !== 'object') return null;
  const dirs = o.dirs && typeof o.dirs === 'object' ? o.dirs : {};
  const tabs = o.tabs && typeof o.tabs === 'object' ? o.tabs : {};
  const at = o.activeTab && typeof o.activeTab === 'object' ? o.activeTab : {};
  return {
    dirs: { left: str(dirs.left), right: str(dirs.right) },
    active: side(o.active),
    tabs: { left: dirList(tabs.left), right: dirList(tabs.right) },
    activeTab: { left: index(at.left), right: index(at.right) },
  };
}

/**
 * ワークスペースが保存する分だけ残す。保存しない項目は「何も覚えていない」状態に戻す。
 * 場所を保存しないならタブ（これも場所の一覧）も残さない。
 */
export function filterSession(session, keep) {
  const s = cleanSession(session);
  if (!s) return null;
  const k = normalizeKeep(keep);
  if (!k.dirs) {
    s.dirs = { left: null, right: null };
    s.tabs = { left: null, right: null };
    s.activeTab = { left: 0, right: 0 };
  } else if (!k.tabs) {
    s.tabs = { left: null, right: null };
    s.activeTab = { left: 0, right: 0 };
  }
  if (!k.active_pane) s.active = 'left';
  return s;
}

/** 旧形式のスナップショット { left:[], right:[], activeLeft, activeRight, active } → セッション */
function snapshotToSession(snap) {
  const left = dirList(snap.left);
  const right = dirList(snap.right);
  const al = left ? Math.min(index(snap.activeLeft), left.length - 1) : 0;
  const ar = right ? Math.min(index(snap.activeRight), right.length - 1) : 0;
  return {
    dirs: { left: left ? left[al] : null, right: right ? right[ar] : null },
    active: side(snap.active),
    tabs: { left, right },
    activeTab: { left: al, right: ar },
  };
}

/**
 * セッションを両ペインのタブ構成にする（適用用）。タブが無ければ場所1つのタブ、
 * 場所も無ければ空（呼び出し側がホームで始める）。
 */
export function sessionToLayout(session) {
  const s = cleanSession(session) || cleanSession({});
  const pane = (p) => {
    if (s.tabs[p]) return { list: s.tabs[p], idx: Math.min(s.activeTab[p], s.tabs[p].length - 1) };
    return { list: s.dirs[p] ? [s.dirs[p]] : [], idx: 0 };
  };
  const l = pane('left');
  const r = pane('right');
  return { left: l.list, right: r.list, activeLeft: l.idx, activeRight: r.idx, active: s.active };
}

function cleanName(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 読み込んだもの（新形式・旧形式・壊れたもの・無し）を使える形にする。
 * @param {*} raw localStorage の中身（JSON.parse 済み）
 * @param {object|null} legacySession それまでの単一セッション（session.js）
 */
export function normalizeStore(raw, legacySession = null) {
  const items = [];
  const seen = new Set();
  const push = (name, keep, session) => {
    const n = cleanName(name);
    if (!n || seen.has(n)) return;
    seen.add(n);
    items.push({ name: n, keep: normalizeKeep(keep), session: filterSession(session, keep) });
  };
  let active = null;
  if (Array.isArray(raw)) {
    // 旧形式: 単一セッションを default にし、各スナップショットを同名で続ける
    push(DEFAULT_WORKSPACE, null, legacySession);
    for (const snap of raw) {
      if (snap && typeof snap === 'object') push(snap.name, null, snapshotToSession(snap));
    }
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
    for (const w of raw.items) if (w && typeof w === 'object') push(w.name, w.keep, w.session);
    active = cleanName(raw.active);
  }
  if (!items.length) push(DEFAULT_WORKSPACE, null, legacySession);
  if (!items.some((w) => w.name === active)) active = items[0].name;
  return { active, items };
}

/** 名前が使えない理由。使えるなら null。except はリネームで自分自身を除くため。 */
export function nameError(name, items, except = null) {
  const n = cleanName(name);
  if (!n) return '名前を入力してください';
  if (n.length > MAX_NAME) return `名前は ${MAX_NAME} 文字までです`;
  if (n !== except && items.some((w) => w.name === n)) return `「${n}」は既にあります`;
  return null;
}

function copy(w) {
  return { name: w.name, keep: { ...w.keep }, session: w.session ? cleanSession(w.session) : null };
}

/**
 * ワークスペースのモデル。変更は subscribe へ通知する（永続化・UI 更新・ウィンドウ間同期）。
 * @param {*} [raw] 保存されていたもの
 * @param {object|null} [legacySession]
 */
export function createWorkspaces(raw = null, legacySession = null) {
  let store = normalizeStore(raw, legacySession);
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(list()));
  const find = (name) => store.items.find((w) => w.name === name);

  function list() {
    return store.items.map((w) => ({ ...copy(w), active: w.name === store.active }));
  }

  function commit(next) {
    if (JSON.stringify(next) === JSON.stringify(store)) return false;
    store = next;
    emit();
    return true;
  }

  function mapItem(name, fn) {
    return { ...store, items: store.items.map((w) => (w.name === name ? fn(w) : w)) };
  }

  return {
    list,
    active: () => store.active,
    get: (name) => {
      const w = find(name);
      return w ? copy(w) : null;
    },
    /** 使用中のワークスペースのセッション（保存する分だけ）。 */
    activeSession: () => {
      const w = find(store.active);
      return w && w.session ? cleanSession(w.session) : null;
    },
    nameError: (name, except = null) => nameError(name, store.items, except),

    /** 空のワークスペースを足す。名前が使えなければ例外。 */
    add(name, keep = defaultKeep()) {
      const err = nameError(name, store.items);
      if (err) throw new Error(err);
      commit({
        ...store,
        items: [
          ...store.items,
          { name: cleanName(name), keep: normalizeKeep(keep), session: null },
        ],
      });
    },

    /** 名前を変える（使用中なら使用中のまま追従）。 */
    rename(from, to) {
      if (!find(from)) return;
      const err = nameError(to, store.items, from);
      if (err) throw new Error(err);
      const name = cleanName(to);
      const next = mapItem(from, (w) => ({ ...w, name }));
      commit(store.active === from ? { ...next, active: name } : next);
    },

    /** 削除。使用中と最後の1つは消せない（先に切り替える）。 */
    remove(name) {
      if (!find(name)) return;
      if (name === store.active)
        throw new Error('使用中のワークスペースは、切り替えてから削除してください');
      if (store.items.length <= 1) throw new Error('最後のワークスペースは削除できません');
      commit({ ...store, items: store.items.filter((w) => w.name !== name) });
    },

    /** 保存する項目を変える。保存しなくなった分はセッションから落とす。 */
    setKeep(name, keep) {
      if (!find(name)) return;
      const k = normalizeKeep(keep);
      commit(mapItem(name, (w) => ({ ...w, keep: k, session: filterSession(w.session, k) })));
    },

    /** 使用中を切り替える（セッションの保存・適用は呼び出し側）。 */
    setActive(name) {
      if (!find(name)) return;
      commit({ ...store, active: name });
    },

    /** 使用中のワークスペースに今のセッションを記録する。変化が無ければ何もしない。 */
    record(session) {
      const w = find(store.active);
      if (!w) return;
      commit(mapItem(store.active, (x) => ({ ...x, session: filterSession(session, x.keep) })));
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** 丸ごと置き換える（別ウィンドウの変更を取り込む）。同じ内容なら何もしない。 */
    replace(next) {
      commit(normalizeStore(next));
    },

    toJSON: () => ({ active: store.active, items: store.items.map(copy) }),
  };
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 保存されていたもの（JSON.parse 済み、無ければ null）。正規化は createWorkspaces。 */
export function loadStoredWorkspaces(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeWorkspaces(data, storage = safeStorage()) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // プライベートモード等は無視
  }
}
