// safemode.js — 安全/操作モードの単一の真実源 (FR-04 / NFR-R1)
// 破壊的操作は必ず canMutate() を通すことで、UIだけでなくロジック層でゲートする。

export const MODE = Object.freeze({
  SAFE: 'safe',
  OPERATION: 'operation',
});

/**
 * 安全モードの状態を管理するファクトリ。
 * @param {string} initial 初期モード（既定: 安全モード = NFR-R1）
 */
export function createSafeMode(initial = MODE.SAFE) {
  let mode = initial === MODE.OPERATION ? MODE.OPERATION : MODE.SAFE;
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) fn(mode);
  }

  return {
    /** 現在のモードを返す */
    get() {
      return mode;
    },
    /** 安全モードか */
    isSafe() {
      return mode === MODE.SAFE;
    },
    /** 破壊的操作（移動/コピー先/貼付/削除/リネーム/新規/上書き）が許可されるか */
    canMutate() {
      return mode === MODE.OPERATION;
    },
    /** モードを明示設定する */
    set(next) {
      const normalized = next === MODE.OPERATION ? MODE.OPERATION : MODE.SAFE;
      if (normalized !== mode) {
        mode = normalized;
        emit();
      }
      return mode;
    },
    /** 安全 ⇄ 操作 をトグルする (Ctrl+Shift+Space) */
    toggle() {
      mode = mode === MODE.SAFE ? MODE.OPERATION : MODE.SAFE;
      emit();
      return mode;
    },
    /** モード変更を購読する。解除関数を返す */
    subscribe(fn) {
      listeners.add(fn);
      fn(mode); // 初期値で即時通知
      return () => listeners.delete(fn);
    },
  };
}
