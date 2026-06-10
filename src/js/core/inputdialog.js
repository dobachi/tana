// inputdialog.js — 1行テキスト入力モーダル（リネーム・新規フォルダ名など）
// 返り値: 文字列（OK）/ null（キャンセル）。

/**
 * 入力ダイアログ関数を生成する。
 * @param {Document} [doc]
 * @returns {(title: string, defaultValue?: string) => Promise<string|null>}
 */
export function createInputDialog(doc = typeof document !== 'undefined' ? document : null) {
  return function ask(title, defaultValue = '') {
    return new Promise((resolve) => {
      if (!doc || !doc.body) {
        resolve(null);
        return;
      }
      const overlay = doc.createElement('div');
      overlay.className = 'modal-overlay';

      const box = doc.createElement('div');
      box.className = 'modal';

      const label = doc.createElement('label');
      label.className = 'modal-label';
      label.textContent = title;
      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'modal-input';
      input.value = defaultValue;
      label.appendChild(input);

      const row = doc.createElement('div');
      row.className = 'modal-buttons';
      const ok = doc.createElement('button');
      ok.type = 'button';
      ok.className = 'modal-btn primary';
      ok.textContent = 'OK (Enter)';
      ok.addEventListener('click', () => finish(input.value));
      const cancel = doc.createElement('button');
      cancel.type = 'button';
      cancel.className = 'modal-btn';
      cancel.textContent = 'キャンセル (Esc)';
      cancel.addEventListener('click', () => finish(null));
      row.append(ok, cancel);

      box.append(label, row);
      overlay.appendChild(box);

      function onKey(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }
      overlay.addEventListener('keydown', onKey);
      doc.body.appendChild(overlay);

      function finish(value) {
        overlay.remove();
        resolve(value);
      }

      input.focus();
      // 拡張子の手前まで選択（リネームしやすく）
      const dot = defaultValue.lastIndexOf('.');
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });
  };
}
