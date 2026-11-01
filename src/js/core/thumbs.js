// thumbs.js — 一覧の名前の左に出す小さな写真（サムネイル）。
//
// 縮小とキャッシュは Rust（src-tauri/src/thumbs.rs）。ここは、どのファイルに出すかの判断と、
// 読み込みの順番待ち（同時に concurrency 枚まで。見えなくなった行の分は取り消せる）。

import { isRemote } from './remotepath.js';

export const THUMBS_KEY = 'tana.list.thumbnails';
/** Rust へ頼む大きさ（長い辺の px）。2 倍の高精細画面でも粗く見えないよう、表示の倍程度 */
export const THUMB_PX = 64;
/** これより大きいファイルには出さない（Rust 側の上限と同じ） */
export const THUMB_MAX_BYTES = 50 * 1024 * 1024;
/** 覚えておく結果の数の上限（古いものから忘れる） */
export const THUMB_MEMO_MAX = 5000;
export const THUMB_EXTS = Object.freeze(['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp']);

/** 保存された設定を読む。既定はオン（'off' のときだけオフ）。 */
export function loadThumbnails(storage = globalThis.localStorage) {
  try {
    return !storage || storage.getItem(THUMBS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function storeThumbnails(on, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(THUMBS_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても今回の切替は効かせる
  }
}

/** 小さな写真を出す対象か（ローカルの、扱える形式の、大きすぎないファイル）。 */
export function isThumbable(entry) {
  if (!entry || entry.is_dir || entry.is_parent || typeof entry.name !== 'string') return false;
  if (isRemote(entry.path)) return false;
  if (typeof entry.size === 'number' && entry.size > THUMB_MAX_BYTES) return false;
  const dot = entry.name.lastIndexOf('.');
  if (dot < 0) return false;
  return THUMB_EXTS.includes(entry.name.slice(dot + 1).toLowerCase());
}

/** 同じ写真・同じ大きさかを見分ける鍵（更新・サイズ・頼む大きさが変われば別物） */
export function thumbKey(entry, px = THUMB_PX) {
  return `${entry.path}\u0000${entry.modified ?? ''}\u0000${entry.size ?? ''}\u0000${px}`;
}

/**
 * 小さな写真の読み込み口。結果（URL か null）は memo に覚え、同じ写真は二度頼まない。
 * memo を複数の loader で共有すると、左右のペインで同じフォルダを見ても一度で済む
 * （読み込み中の分も memo に添えて共有するので、同時に頼んでも 1 回）。
 *
 * @param {{fetch: (entry: object, px: number) => Promise<string|null>, concurrency?: number,
 *          memo?: Map}} deps
 */
export function createThumbLoader({ fetch, concurrency = 4, memo = new Map() }) {
  const queue = []; // {entry, px, key, resolve}
  // 読み込み中（key -> Promise）。memo と一緒に共有する
  if (!memo.inflight) memo.inflight = new Map();
  const inflight = memo.inflight;
  let running = 0;

  function pump() {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      // 待っている間に、別の loader（反対のペイン）が読み始めた・読み終えた
      if (memo.has(job.key)) {
        job.resolve(memo.get(job.key));
        continue;
      }
      if (inflight.has(job.key)) {
        inflight.get(job.key).then(job.resolve);
        continue;
      }
      running += 1;
      const p = Promise.resolve()
        .then(() => fetch(job.entry, job.px))
        .catch(() => null)
        .then((url) => {
          const v = url || null;
          memo.set(job.key, v);
          while (memo.size > THUMB_MEMO_MAX) memo.delete(memo.keys().next().value);
          return v;
        })
        .finally(() => {
          running -= 1;
          inflight.delete(job.key);
          pump();
        });
      inflight.set(job.key, p);
      p.then(job.resolve);
    }
  }

  return {
    /** 覚えている結果（無ければ undefined）。描き直しでちらつかせないため同期で引く */
    peek: (entry, px = THUMB_PX) => memo.get(thumbKey(entry, px)),
    /**
     * 結果を返す。順番待ちのまま cancel されたら null で終わる。
     * @returns {Promise<string|null>}
     */
    load(entry, px = THUMB_PX) {
      const key = thumbKey(entry, px);
      if (memo.has(key)) return Promise.resolve(memo.get(key));
      if (inflight.has(key)) return inflight.get(key);
      return new Promise((resolve) => {
        queue.push({ entry, px, key, resolve });
        pump();
      });
    },
    /** 順番待ちの分を取り消す（フォルダを移った・描き直した）。読み込み中の分は最後まで行う */
    cancel() {
      for (const job of queue.splice(0)) job.resolve(null);
    },
    pendingCount: () => queue.length,
    runningCount: () => running,
  };
}
