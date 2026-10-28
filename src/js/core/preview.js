// preview.js — プレビュー コントローラ (FR-09 段階2)
// カーソル追従の中核。デバウンス + 世代トークンで「j/k 連打で I/O が殺到し、
// 遅い読み込みが新しい選択を上書きする」問題を防ぐ（PREVIEW.md §7）。
// レンダラ（features/preview/render.js）は遅延ロードする（NFR-P2）。

import { KIND, LIMITS, detectKind, maxBytesFor } from './previewkind.js';
import { isRemote } from './remotepath.js';
import { resolveMarkdownImages } from './mdimages.js';
import { pdfDecision } from './pdfpreview.js';

/** リモートの画像は手元へ取得してから表示する。回線を占有しないよう大きさに上限を設ける。 */
export const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;

const NOTE = {
  [KIND.DIR]: 'フォルダです',
  [KIND.TOO_LARGE]: '大きすぎるためプレビューしません',
  [KIND.BINARY]: 'バイナリのためプレビューできません',
  [KIND.EMPTY]: '空のファイルです',
};

/**
 * @param {object} deps
 * @param {{readPreview:Function, assetUrl:Function, previewSrc?:Function, readFileBytes?:Function}} deps.backend
 *   previewSrc があれば画像の表示元はそれで得る（リモートは取得してから, FR-20）
 * @param {() => HTMLElement} deps.getContainer プレビュー本文の入れ物
 * @param {() => {enabled: boolean, installed: boolean}} [deps.pdf] PDF プレビュー（拡張 pdfjs）の可否。既定は無効
 * @param {() => Promise<object>} [deps.loadPdf] PDF レンダラ（遅延）
 * @param {() => boolean} [deps.isDark] 暗いテーマか（PDF の背景色）
 * @param {() => Promise<object>} [deps.loadRenderers] レンダラモジュール（遅延）
 * @param {Document} [deps.doc]
 * @param {number} [deps.debounceMs]
 * @param {typeof LIMITS} [deps.limits]
 * @param {{set:Function, clear:Function}} [deps.scheduler] タイマ（テスト注入用）
 */
/** 描画済みかを見分ける鍵。外部で書き換わったファイルは更新日時かサイズが変わる。 */
function renderKey(entry) {
  return `${entry.path}\u0000${entry.size ?? ''}\u0000${entry.modified ?? ''}`;
}

export function createPreview(deps) {
  const {
    backend,
    getContainer,
    getInfoContainer = () => null,
    onImage = null, // 画像を描画した直後に呼ぶ (FR-16: 表示モードの結線)
    pdf = () => ({ enabled: false, installed: false }),
    loadPdf = () => import('../features/pdf/adapter.js'),
    isDark = () => false,
    loadRenderers = () => import('../features/preview/render.js'),
    loadMarkdown = () => import('../features/preview/markdown.js'),
    doc = typeof document !== 'undefined' ? document : null,
    debounceMs = LIMITS.debounceMs,
    limits = LIMITS,
    scheduler = defaultScheduler(),
  } = deps;

  let opened = false;
  let target = null; // 直近の setTarget 対象（未オープン時も記録）
  let renderedPath = null; // 現在描画中の対象（パス+サイズ+更新日時。同じなら再読込しない）
  let generation = 0;
  let timer = null;

  function clearTimer() {
    if (timer != null) {
      scheduler.clear(timer);
      timer = null;
    }
  }

  async function load(entry) {
    const gen = ++generation;
    const container = getContainer();
    if (!container) return;
    let R;
    try {
      R = await loadRenderers();
    } catch {
      return;
    }
    if (gen !== generation) return; // 追い越された

    const infoEl = getInfoContainer();
    const info = (kind, data, src) => {
      if (infoEl) R.renderInfo(infoEl, { entry, kind, data, src }, doc);
    };

    try {
      if (!entry) {
        container.innerHTML = '';
        if (infoEl) infoEl.innerHTML = '';
        renderedPath = null;
        return;
      }
      const kind1 = detectKind(entry, null, limits);

      if (kind1 === KIND.IMAGE) {
        if (isRemote(entry.path) && entry.size > MAX_REMOTE_IMAGE_BYTES) {
          R.renderPlaceholder(container, { kind: KIND.TOO_LARGE, note: NOTE[KIND.TOO_LARGE] }, doc);
          info(KIND.TOO_LARGE, null, null);
          renderedPath = renderKey(entry);
          return;
        }
        const src = backend.previewSrc
          ? await backend.previewSrc(entry.path)
          : backend.assetUrl(entry.path);
        if (gen !== generation) return;
        R.renderImage(container, { entry, src }, doc);
        if (onImage) onImage(container);
        info(KIND.IMAGE, null, src);
        renderedPath = renderKey(entry);
        return;
      }
      if (kind1 === KIND.PDF) {
        const d = pdfDecision({ ...pdf(), size: entry.size, maxBytes: limits.maxPreviewBytes });
        if (!d.show) {
          R.renderPlaceholder(container, { kind: KIND.PDF, note: d.note }, doc);
          info(KIND.PDF, null, null);
          renderedPath = renderKey(entry);
          return;
        }
        const [P, data] = await Promise.all([
          loadPdf(),
          backend.readFileBytes(entry.path, limits.maxPreviewBytes),
        ]);
        if (gen !== generation) return;
        const infoEl2 = getInfoContainer();
        P.renderPdf(
          container,
          {
            data,
            dark: isDark(),
            onLoaded: (pages) => {
              if (gen !== generation || !infoEl2) return;
              R.renderInfo(infoEl2, { entry, kind: KIND.PDF, data: { pages } }, doc);
            },
            onError: (note) => {
              if (gen !== generation) return;
              R.renderPlaceholder(container, { kind: KIND.PDF, note }, doc);
            },
          },
          doc,
        );
        info(KIND.PDF, null, null);
        renderedPath = renderKey(entry);
        return;
      }
      if (
        kind1 === KIND.DIR ||
        kind1 === KIND.EMPTY ||
        kind1 === KIND.TOO_LARGE ||
        kind1 === KIND.BINARY
      ) {
        R.renderPlaceholder(container, { kind: kind1, note: NOTE[kind1] }, doc);
        info(kind1, null, null);
        renderedPath = renderKey(entry);
        return;
      }

      // TEXT / MARKDOWN → 上限付きで読む
      const data = await backend.readPreview(entry.path, maxBytesFor(kind1, limits));
      if (gen !== generation) return;
      if (!data) {
        R.renderPlaceholder(container, { kind: KIND.BINARY, note: '読み取れませんでした' }, doc);
        info(KIND.BINARY, null, null);
        renderedPath = renderKey(entry);
        return;
      }
      const kind2 = detectKind(entry, data.sniff, limits);
      if (kind2 === KIND.BINARY) {
        R.renderPlaceholder(container, { kind: KIND.BINARY, note: NOTE[KIND.BINARY] }, doc);
        info(KIND.BINARY, data, null);
      } else if (kind2 === KIND.MARKDOWN) {
        const M = await loadMarkdown(); // 遅延: markdown-it は .md のときだけ読む
        if (gen !== generation) return;
        M.renderMarkdown(container, { data }, doc);
        info(KIND.MARKDOWN, data, null);
        const mdPath = entry.path;
        resolveMarkdownImages(container, mdPath, {
          toSrc: (p) => (backend.previewSrc ? backend.previewSrc(p) : backend.assetUrl(p)),
          isCurrent: () => gen === generation,
        }).catch(() => {});
      } else {
        R.renderText(container, { data }, doc);
        info(KIND.TEXT, data, null);
      }
      renderedPath = renderKey(entry);
    } catch {
      if (gen !== generation) return;
      R.renderPlaceholder(container, { kind: KIND.BINARY, note: '読み取れませんでした' }, doc);
      info(KIND.BINARY, null, null);
      renderedPath = renderKey(entry);
    }
  }

  function scheduleLoad() {
    clearTimer();
    timer = scheduler.set(() => {
      timer = null;
      load(target);
    }, debounceMs);
  }

  return {
    /** カーソル位置のファイルを対象にする。閉じているときは記録のみ（I/O しない）。 */
    setTarget(entry) {
      target = entry || null;
      if (!opened) return;
      // 同一パスへの再指定は無視（同じ場所での選択トグル等で無駄に再読しない）
      // 同じファイルでも中身が変わっていれば（サイズ/更新日時）読み直す (FR-19)
      if (target && renderKey(target) === renderedPath) return;
      scheduleLoad();
    },
    open() {
      if (opened) return;
      opened = true;
      renderedPath = null;
      load(target); // 開いた瞬間は即読み込み（デバウンスなし）
    },
    close() {
      if (!opened) return;
      opened = false;
      clearTimer();
      generation += 1; // 進行中の読み込みを無効化
      const c = getContainer();
      if (c) c.innerHTML = '';
      const i = getInfoContainer();
      if (i) i.innerHTML = '';
      renderedPath = null;
    },
    isOpen() {
      return opened;
    },
    /** 現在の対象を強制再描画（テーマ変更などで使用）。 */
    refresh() {
      if (!opened) return;
      renderedPath = null;
      load(target);
    },
  };
}

function defaultScheduler() {
  return {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id),
  };
}
