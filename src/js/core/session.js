// session.js — セッション復元 (FR-14)。各ペインのカレントディレクトリ・
// アクティブペイン・タブ構成(FR-08) を localStorage に保存し、次回起動で復元する。
// テーマ/プレビュー配置/ソート/隠しファイル等は各モジュールが別途永続化する。
//
// 保存はデバウンス（頻繁なディレクトリ移動でも書き込みは1回にまとめる）。
// 復元時、存在しなくなったパスは呼び出し側でフォールバックする。
// tabs が無い旧セッションとも後方互換（tabs=null なら dirs から単一タブ）。

const STORAGE_KEY = 'tana.session';

/** 文字列パスの配列だけを取り出す。空配列/非配列は null。 */
function cleanTabs(v) {
  if (!Array.isArray(v)) return null;
  const list = v.filter((p) => typeof p === 'string' && p);
  return list.length ? list : null;
}

/** 0以上の整数に丸める（不正は 0）。 */
function cleanIndex(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/** 保存済みセッションを読む。無ければ null。 */
export function loadSession(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) || {};
    const dirs = o.dirs && typeof o.dirs === 'object' ? o.dirs : {};
    const tabs = o.tabs && typeof o.tabs === 'object' ? o.tabs : {};
    const activeTab = o.activeTab && typeof o.activeTab === 'object' ? o.activeTab : {};
    return {
      dirs: {
        left: typeof dirs.left === 'string' ? dirs.left : null,
        right: typeof dirs.right === 'string' ? dirs.right : null,
      },
      active: o.active === 'right' ? 'right' : 'left',
      tabs: { left: cleanTabs(tabs.left), right: cleanTabs(tabs.right) },
      activeTab: { left: cleanIndex(activeTab.left), right: cleanIndex(activeTab.right) },
    };
  } catch {
    return null;
  }
}

/** セッションを保存する。 */
export function storeSession(state, storage = safeStorage()) {
  try {
    if (!storage) return;
    const dirs = (state && state.dirs) || {};
    const tabs = (state && state.tabs) || {};
    const activeTab = (state && state.activeTab) || {};
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dirs: {
          left: typeof dirs.left === 'string' ? dirs.left : null,
          right: typeof dirs.right === 'string' ? dirs.right : null,
        },
        active: state && state.active === 'right' ? 'right' : 'left',
        tabs: { left: cleanTabs(tabs.left), right: cleanTabs(tabs.right) },
        activeTab: { left: cleanIndex(activeTab.left), right: cleanIndex(activeTab.right) },
      }),
    );
  } catch {
    // プライベートモード等は無視
  }
}

/**
 * デバウンス付きのセッション保存。schedule() を呼ぶと delay 後に getState() を
 * 保存する。タイマ関数は注入可能（テスト用）。
 * @param {{getState:()=>object, store:(s:object)=>void, delay?:number,
 *          setTimeoutFn?:Function, clearTimeoutFn?:Function}} deps
 */
export function createSessionSaver({
  getState,
  store,
  delay = 400,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timer = null;
  function run() {
    timer = null;
    store(getState());
  }
  return {
    schedule() {
      if (timer) clearTimeoutFn(timer);
      timer = setTimeoutFn(run, delay);
    },
    /** 保留中があれば即保存（終了時などに使える）。 */
    flush() {
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
      store(getState());
    },
  };
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
