// conflictdialog.js — ファイル名衝突時の解決モーダル (FR-02 / NFR-R3)
// 返り値: { action: 'rename'|'overwrite'|'cancel', name?: string }
//   rename 時は入力欄の名前を使う（既定はインクリメント名）。
// ネイティブダイアログは入力＋3択を出せないため、アプリ内モーダルで実装する。

export const CHOICE = Object.freeze({
  RENAME: 'rename',
  OVERWRITE: 'overwrite',
  CANCEL: 'cancel',
});

/**
 * 衝突解決ダイアログ関数を生成する。
 * @param {Document} [doc]
 * @returns {(name: string, suggested: string) => Promise<{action: string, name?: string}>}
 */
export function createConflictDialog(doc = typeof document !== 'undefined' ? document : null) {
  return function ask(name, suggested) {
    return new Promise((resolve) => {
      if (!doc || !doc.body) {
        resolve({ action: CHOICE.CANCEL });
        return;
      }
      const overlay = doc.createElement('div');
      overlay.className = 'modal-overlay';

      const box = doc.createElement('div');
      box.className = 'modal';

      const msg = doc.createElement('p');
      msg.className = 'modal-msg';
      msg.textContent = `「${name}」は既に存在します。`;

      const label = doc.createElement('label');
      label.className = 'modal-label';
      label.textContent = '新しい名前:';
      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'modal-input';
      input.value = suggested || '';
      label.appendChild(input);

      const row = doc.createElement('div');
      row.className = 'modal-buttons';

      function makeBtn(text, onClick, primary) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'modal-btn' + (primary ? ' primary' : '');
        b.textContent = text;
        b.addEventListener('click', onClick);
        return b;
      }
      const bRename = makeBtn(
        '名前を変えて実行 (Enter)',
        () => finish({ action: CHOICE.RENAME, name: input.value }),
        true,
      );
      const bOver = makeBtn('上書き', () => finish({ action: CHOICE.OVERWRITE }), false);
      const bCancel = makeBtn('キャンセル (Esc)', () => finish({ action: CHOICE.CANCEL }), false);
      row.append(bRename, bOver, bCancel);

      box.append(msg, label, row);
      overlay.appendChild(box);

      function onKey(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish({ action: CHOICE.RENAME, name: input.value });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish({ action: CHOICE.CANCEL });
        }
      }
      overlay.addEventListener('keydown', onKey);
      doc.body.appendChild(overlay);

      function finish(result) {
        overlay.remove();
        resolve(result);
      }

      // 入力欄にフォーカスし、拡張子前まで選択（名前を変えやすく）
      input.focus();
      input.select();
    });
  };
}
