// adapter.js — PDF プレビュー。拡張 "pdfjs"（pdf.js）を sandbox iframe の中で動かす。
//
// 取得したエンジンはアプリの権限を持たせない: iframe は sandbox="allow-scripts"（不透明オリジン）で、
// 中身は本体同梱の pdf-runner/runner.html。エンジンのファイルの中身と PDF のバイト列を
// postMessage で渡し、runner が blob: URL から読み込んで描く（Fude の Mermaid 拡張と同じ方式）。
// 遅延ロード: PDF を表示するときだけ読む。

import { readExtensionFile } from '../../backend.js';
import { PDF_EXT_ID, PDF_ENGINE_FILES } from '../../core/pdfpreview.js';

export const RUNNER_URL = 'pdf-runner/runner.html';

let enginePromise = null;

/**
 * エンジンのファイルを読む（一度読んだら使い回す。失敗したら次回やり直す）。
 * @param {(id: string, rel: string) => Promise<string>} [read]
 */
export function loadEngine(read = readExtensionFile) {
  if (!enginePromise) {
    const keys = Object.keys(PDF_ENGINE_FILES);
    enginePromise = Promise.all(keys.map((k) => read(PDF_EXT_ID, PDF_ENGINE_FILES[k])))
      .then((texts) => Object.fromEntries(keys.map((k, i) => [k, texts[i]])))
      .catch((err) => {
        enginePromise = null;
        throw err;
      });
  }
  return enginePromise;
}

/** 入れ直し・削除の後に呼ぶ（古いエンジンを使わない）。 */
export function resetEngine() {
  enginePromise = null;
}

/**
 * PDF を描く iframe を container に置く。
 * @param {HTMLElement} container
 * @param {{data: ArrayBuffer, dark?: boolean, onLoaded?: (pages: number) => void,
 *          onError?: (message: string) => void}} arg
 * @param {Document} doc
 * @param {{loadEngine?: typeof loadEngine, win?: Window}} [opts]
 * @returns {HTMLIFrameElement}
 */
export function renderPdf(container, arg, doc, opts = {}) {
  const { data, dark = false, onLoaded, onError } = arg;
  const load = opts.loadEngine || loadEngine;
  const win = opts.win || doc.defaultView;
  container.innerHTML = '';
  const frame = doc.createElement('iframe');
  frame.className = 'preview-pdf';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.tabIndex = -1; // Tab の巡回で PDF に入り込まない
  frame.title = 'PDF';

  const onMessage = (e) => {
    if (!frame.isConnected) {
      win.removeEventListener('message', onMessage);
      return;
    }
    if (e.source !== frame.contentWindow) return;
    const msg = e.data || {};
    if (msg.type === 'ready') {
      load()
        .then((engine) => {
          if (frame.isConnected) {
            frame.contentWindow.postMessage({ type: 'show', engine, data, dark }, '*', [data]);
          }
        })
        .catch(
          (err) => onError && onError(`PDF エンジンを読めませんでした: ${err?.message || err}`),
        );
    } else if (msg.type === 'loaded') {
      if (onLoaded) onLoaded(msg.pages);
    } else if (msg.type === 'error') {
      win.removeEventListener('message', onMessage);
      if (onError) onError(msg.message);
    }
  };
  win.addEventListener('message', onMessage);
  frame.src = RUNNER_URL;
  container.appendChild(frame);
  return frame;
}
