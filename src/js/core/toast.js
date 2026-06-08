// toast.js — 一時的な通知（安全モードの抑止フィードバック・操作結果, NFR-U3）

/**
 * トースト表示関数を生成する。
 * @param {Document} [doc] テスト時に差し替え可能
 * @returns {(message: string, ms?: number) => void}
 */
export function createToast(doc = typeof document !== 'undefined' ? document : null) {
  let el = null;
  let timer = null;

  return function show(message, ms = 2400) {
    if (!doc || !doc.body) return;
    if (!el) {
      el = doc.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      doc.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (el) el.classList.remove('show');
    }, ms);
  };
}
