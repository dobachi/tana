// sortstate.js — ソート状態（key/dir/foldersFirst）の真実源 + localStorage 永続化。
// theme.js / previewplacement.js と同型。両ペイン共通（DV-Q2 は当面「共通」）。

import { SORT_KEYS, DEFAULT_SORT, nextSort } from './sort.js';

const STORAGE_KEY = 'tana.sort';

function normalize(s) {
  const o = s || {};
  return {
    key: SORT_KEYS.includes(o.key) ? o.key : DEFAULT_SORT.key,
    dir: o.dir === 'desc' ? 'desc' : 'asc',
    foldersFirst: o.foldersFirst !== false,
  };
}

/**
 * ソート状態のファクトリ。
 * @param {{key?:string, dir?:string, foldersFirst?:boolean}} [initial]
 */
export function createSortState(initial) {
  let state = normalize(initial);
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) fn({ ...state });
  }

  return {
    get() {
      return { ...state };
    },
    /** キー指定。同じキーなら方向トグル、別キーなら昇順（列ヘッダ/キー操作用）。 */
    applyKey(key) {
      state = normalize(nextSort(state, key));
      emit();
      return this.get();
    },
    /** 状態を直接設定（メニューからの昇順/降順指定など）。 */
    set(next) {
      state = normalize({ ...state, ...next });
      emit();
      return this.get();
    },
    /** 現在キーの方向を反転（reverse）。 */
    reverse() {
      state = normalize({ ...state, dir: state.dir === 'asc' ? 'desc' : 'asc' });
      emit();
      return this.get();
    },
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
  };
}

/** 保存済みソート設定を読む（無ければ既定）。 */
export function loadStoredSort(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_SORT };
  } catch {
    return { ...DEFAULT_SORT };
  }
}

/** ソート設定を永続化する。 */
export function storeSort(state, storage = safeStorage()) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(normalize(state)));
  } catch {
    // プライベートモード等は無視
  }
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
