// modalheader.js — オーバーレイ画面の見出し行（題名 + 右上の × 閉じる）。
//
// Esc や外側クリックを知らなくても、マウスで閉じられるようにする。

/**
 * @param {Document} doc
 * @param {{title: string, titleClass: string, onClose: () => void}} opts
 * @returns {HTMLElement} 見出し行（題名の h2 と × ボタン）
 */
export function createModalHeader(doc, { title, titleClass, onClose }) {
  const head = doc.createElement('div');
  head.className = 'modal-header';
  const h = doc.createElement('h2');
  h.className = titleClass;
  h.textContent = title;
  const x = doc.createElement('button');
  x.type = 'button';
  x.className = 'modal-close';
  x.textContent = '×';
  x.title = '閉じる（Esc）';
  x.setAttribute('aria-label', '閉じる');
  x.addEventListener('click', onClose);
  head.append(h, x);
  return head;
}
