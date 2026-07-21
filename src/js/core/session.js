// session.js — セッション復元 (FR-14)。各ペインのカレントディレクトリと
// アクティブペインを localStorage に保存し、次回起動で復元する。
// テーマ/プレビュー配置/ソート/隠しファイル等は各モジュールが別途永続化する。
//
// 保存はデバウンス（頻繁なディレクトリ移動でも書き込みは1回にまとめる）。
// 復元時、存在しなくなったパスは呼び出し側でフォールバックする。

const STORAGE_KEY = 'tana.session';

/** 保存済みセッションを読む。無ければ null。 */
export function loadSession(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) || {};
    const dirs = o.dirs && typeof o.dirs === 'object' ? o.dirs : {};
    return {
      dirs: {
        left: typeof dirs.left === 'string' ? dirs.left : null,
        right: typeof dirs.right === 'string' ? dirs.right : null,
      },
      active: o.active === 'right' ? 'right' : 'left',
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
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dirs: {
          left: typeof dirs.left === 'string' ? dirs.left : null,
          right: typeof dirs.right === 'string' ? dirs.right : null,
        },
        active: state && state.active === 'right' ? 'right' : 'left',
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
