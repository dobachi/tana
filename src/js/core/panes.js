// panes.js — 2ペイン管理 (FR-01)
// アクティブペインの概念を持ち、Tab でフォーカスを往復する。

export const PANE = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
});

export function createPanes(initial = PANE.LEFT) {
  let active = initial === PANE.RIGHT ? PANE.RIGHT : PANE.LEFT;
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) fn(active);
  }

  return {
    /** アクティブなペイン ('left' | 'right') */
    getActive() {
      return active;
    },
    /** 非アクティブ（操作の相手先）ペイン */
    getInactive() {
      return active === PANE.LEFT ? PANE.RIGHT : PANE.LEFT;
    },
    /** アクティブペインを設定 */
    setActive(pane) {
      const next = pane === PANE.RIGHT ? PANE.RIGHT : PANE.LEFT;
      if (next !== active) {
        active = next;
        emit();
      }
      return active;
    },
    /** L ⇄ R を切り替え (Tab) */
    toggle() {
      active = active === PANE.LEFT ? PANE.RIGHT : PANE.LEFT;
      emit();
      return active;
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(active);
      return () => listeners.delete(fn);
    },
  };
}
