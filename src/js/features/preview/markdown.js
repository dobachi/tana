// features/preview/markdown.js — Markdown レンダラ (FR-09 段階3)
// markdown-it を使うが、これは重い（NFR-P2）。esbuild のコード分割により、
// このモジュール（と markdown-it）は .md をプレビューしたときだけ読み込まれる。
//
// セキュリティ: html:false で生 HTML を無効化する（PREVIEW.md §9）。ファイラは
// 素性の分からないファイルを開くため、生 HTML/スクリプトを通さないのが要。
// markdown-it の既定 validateLink が javascript: 等の危険スキームも弾く。

import MarkdownIt from 'markdown-it';

let md = null;
function getMd() {
  if (!md) {
    md = new MarkdownIt({
      html: false, // 生 HTML を通さない（サニタイズ不要の安全側）
      linkify: true,
      typographer: true,
      breaks: true,
    });
  }
  return md;
}

/**
 * Markdown をレンダリングして container に描画する。
 * @param {HTMLElement} container
 * @param {{data:{text?:string, truncated?:boolean}}} arg
 * @param {Document} doc
 */
export function renderMarkdown(container, { data }, doc) {
  container.innerHTML = '';
  const wrap = doc.createElement('div');
  wrap.className = 'preview-markdown';
  // html:false のため、生成される HTML は Markdown 由来の安全な要素のみ。
  wrap.innerHTML = getMd().render((data && data.text) || '');
  container.appendChild(wrap);
  if (data && data.truncated) {
    const note = doc.createElement('p');
    note.className = 'preview-truncated';
    note.textContent = '先頭のみ表示（以降は省略）';
    container.appendChild(note);
  }
}
