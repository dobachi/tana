// windowsync.js — 複数ウィンドウの間で保存内容をそろえる（純粋・DOM 非依存）。
//
// 各ウィンドウは起動時に localStorage から読み、変えたら書く。そのままだと、あるウィンドウで
// 足したお気に入りを、古い内容のまま持っている別のウィンドウが次に書くときに消してしまう。
// そこで、別のウィンドウが書いたとき（storage イベント）に読み直して取り込む。
// storage イベントは書いたウィンドウ自身には届かず、値が変わらない書き込みでも届かない。

/**
 * storage イベントの処理関数を作る。
 * @param {Record<string, (value: any) => void>} handlers キー → 新しい値（JSON を解いたもの）を取り込む関数
 * @param {{storage?: object}} [opts] storage: 自分の localStorage（別の保存領域のイベントは無視）
 * @returns {(event: {key: string|null, newValue: string|null, storageArea?: object}) => boolean}
 *   取り込んだら true
 */
export function createStorageSync(handlers, opts = {}) {
  return function onStorage(event) {
    if (!event || typeof event.key !== 'string') return false; // clear() などは対象外
    if (opts.storage && event.storageArea && event.storageArea !== opts.storage) return false;
    const fn = handlers[event.key];
    if (typeof fn !== 'function') return false;
    let value = null;
    if (event.newValue != null) {
      try {
        value = JSON.parse(event.newValue);
      } catch {
        value = event.newValue; // テーマ名など JSON でない値
      }
    }
    try {
      fn(value);
      return true;
    } catch {
      return false; // 壊れた値で落とさない（次に書いた側の内容で揃う）
    }
  };
}

/**
 * 起動時にどこを開き、何を受け持つか。
 * 最初のウィンドウ（main）だけがセッション（前回のタブ構成）を復元・保存し、起動時の
 * 更新確認もする。追加のウィンドウは渡された場所（無ければホーム）を両ペインで開く。
 * @param {{isMain: boolean, cliPath?: string|null, openRequest?: string|null}} s
 * @returns {{startPath: string|null, useSession: boolean, saveSession: boolean, checkUpdates: boolean}}
 *   startPath が null なら「セッション（無ければホーム）」
 */
export function startupPlan({ isMain, cliPath = null, openRequest = null }) {
  if (!isMain) {
    return {
      startPath: openRequest || '',
      useSession: false,
      saveSession: false,
      checkUpdates: false,
    };
  }
  return {
    startPath: cliPath || null,
    useSession: !cliPath,
    saveSession: true,
    checkUpdates: true,
  };
}
