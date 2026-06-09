// conflictdialog.js — ファイル名衝突時の3択モーダル (FR-02 / NFR-R3)
//   'rename'    名前を変えてコピー（インクリメント）
//   'overwrite' 上書き
//   'cancel'    キャンセル
// ネイティブダイアログは2択しか出せないため、アプリ内モーダルで実装する。

export const CHOICE = Object.freeze({
  RENAME: 'rename',
  OVERWRITE: 'overwrite',
  CANCEL: 'cancel',
});

/**
 * 衝突解決ダイアログ関数を生成する。
 * @param {Document} [doc]
 * @returns {(name: string) => Promise<'rename'|'overwrite'|'cancel'>}
 */
export function createConflictDialog(doc = typeof document !== 'undefined' ? document : null) {
  return function ask(name) {
    return new Promise((resolve) => {
      if (!doc || !doc.body) {
        resolve(CHOICE.CANCEL);
        return;
      }
      const overlay = doc.createElement('div');
      overlay.className = 'modal-overlay';

      const box = doc.createElement('div');
      box.className = 'modal';

      const msg = doc.createElement('p');
      msg.className = 'modal-msg';
      msg.textContent = `「${name}」は既に存在します。どうしますか？`;

      const row = doc.createElement('div');
      row.className = 'modal-buttons';

      function makeBtn(label, value, primary) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'modal-btn' + (primary ? ' primary' : '');
        b.textContent = label;
        b.addEventListener('click', () => finish(value));
        return b;
      }
      const bRename = makeBtn('名前を変えて実行 (R)', CHOICE.RENAME, true);
      const bOver = makeBtn('上書き (O)', CHOICE.OVERWRITE, false);
      const bCancel = makeBtn('キャンセル (Esc)', CHOICE.CANCEL, false);
      row.append(bRename, bOver, bCancel);
      box.append(msg, row);
      overlay.appendChild(box);
      doc.body.appendChild(overlay);

      function onKey(e) {
        // 背後のキー操作（ペイン移動等）に渡さない
        e.stopPropagation();
        const k = e.key.toLowerCase();
        if (e.key === 'Escape' || k === 'c') finish(CHOICE.CANCEL);
        else if (e.key === 'Enter' || k === 'r') finish(CHOICE.RENAME);
        else if (k === 'o') finish(CHOICE.OVERWRITE);
      }
      function finish(value) {
        doc.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(value);
      }
      doc.addEventListener('keydown', onKey, true);
      bRename.focus();
    });
  };
}
