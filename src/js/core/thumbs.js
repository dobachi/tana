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

/** 同じ写真かを見分ける鍵（更新・サイズが変われば別物） */
export function thumbKey(entry) {
  return `${entry.path}\u0000${entry.modified ?? ''}\u0000${entry.size ?? ''}`;
}

/**
 * 小さな写真の読み込み口。結果（URL か null）は memo に覚え、同じ写真は二度頼まない。
 * memo を複数の loader で共有すると、左右のペインで同じフォルダを見ても一度で済む。
 *
 * @param {{fetch: (entry: object) => Promise<string|null>, concurrency?: number, memo?: Map}} deps
 */
export function createThumbLoader({ fetch, concurrency = 4, memo = new Map() }) {
  const queue = []; // {entry, key, resolve}
  const inflight = new Map(); // key -> Promise
  let running = 0;

  function pump() {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      running += 1;
      const p = Promise.resolve()
        .then(() => fetch(job.entry))
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
    peek: (entry) => memo.get(thumbKey(entry)),
    /**
     * 結果を返す。順番待ちのまま cancel されたら null で終わる。
     * @returns {Promise<string|null>}
     */
    load(entry) {
      const key = thumbKey(entry);
      if (memo.has(key)) return Promise.resolve(memo.get(key));
      if (inflight.has(key)) return inflight.get(key);
      return new Promise((resolve) => {
        queue.push({ entry, key, resolve });
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
