// preview.js — プレビュー コントローラ (FR-09 段階2)
// カーソル追従の中核。デバウンス + 世代トークンで「j/k 連打で I/O が殺到し、
// 遅い読み込みが新しい選択を上書きする」問題を防ぐ（PREVIEW.md §7）。
// レンダラ（features/preview/render.js）は遅延ロードする（NFR-P2）。

import { KIND, LIMITS, detectKind, maxBytesFor } from './previewkind.js';

const NOTE = {
  [KIND.DIR]: 'フォルダです',
  [KIND.TOO_LARGE]: '大きすぎるためプレビューしません',
  [KIND.BINARY]: 'バイナリのためプレビューできません',
  [KIND.PDF]: 'PDF プレビューは未対応です',
  [KIND.EMPTY]: '空のファイルです',
};

/**
 * @param {object} deps
 * @param {{readPreview:Function, assetUrl:Function}} deps.backend
 * @param {() => HTMLElement} deps.getContainer プレビュー本文の入れ物
 * @param {() => Promise<object>} [deps.loadRenderers] レンダラモジュール（遅延）
 * @param {Document} [deps.doc]
 * @param {number} [deps.debounceMs]
 * @param {typeof LIMITS} [deps.limits]
 * @param {{set:Function, clear:Function}} [deps.scheduler] タイマ（テスト注入用）
 */
export function createPreview(deps) {
  const {
    backend,
    getContainer,
    getInfoContainer = () => null,
    loadRenderers = () => import('../features/preview/render.js'),
    loadMarkdown = () => import('../features/preview/markdown.js'),
    doc = typeof document !== 'undefined' ? document : null,
    debounceMs = LIMITS.debounceMs,
    limits = LIMITS,
    scheduler = defaultScheduler(),
  } = deps;

  let opened = false;
  let target = null; // 直近の setTarget 対象（未オープン時も記録）
  let renderedPath = null; // 現在描画中のパス（同一パス再読込の抑止）
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
        const src = backend.assetUrl(entry.path);
        R.renderImage(container, { entry, src }, doc);
        info(KIND.IMAGE, null, src);
        renderedPath = entry.path;
        return;
      }
      if (
        kind1 === KIND.DIR ||
        kind1 === KIND.EMPTY ||
        kind1 === KIND.TOO_LARGE ||
        kind1 === KIND.BINARY ||
        kind1 === KIND.PDF
      ) {
        R.renderPlaceholder(container, { kind: kind1, note: NOTE[kind1] }, doc);
        info(kind1, null, null);
        renderedPath = entry.path;
        return;
      }

      // TEXT / MARKDOWN → 上限付きで読む
      const data = await backend.readPreview(entry.path, maxBytesFor(kind1, limits));
      if (gen !== generation) return;
      if (!data) {
        R.renderPlaceholder(container, { kind: KIND.BINARY, note: '読み取れませんでした' }, doc);
        info(KIND.BINARY, null, null);
        renderedPath = entry.path;
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
      } else {
        R.renderText(container, { data }, doc);
        info(KIND.TEXT, data, null);
      }
      renderedPath = entry.path;
    } catch {
      if (gen !== generation) return;
      R.renderPlaceholder(container, { kind: KIND.BINARY, note: '読み取れませんでした' }, doc);
      info(KIND.BINARY, null, null);
      renderedPath = entry.path;
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
      if (target && target.path === renderedPath) return;
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
