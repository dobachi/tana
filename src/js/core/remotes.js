// remotes.js — リモート接続の状態（純粋, FR-20）。
//
// - 最近使った接続先と、接続先ごとに最後に開いた場所（localStorage に保存）
// - 接続先ごとの「書き込みを許可」の写し（真実源は Rust。既定は閲覧のみで、
//   アプリを終えると忘れる＝保存しない）
// - 接続画面の候補（最近 → 接続中 → ~/.ssh/config）の並べ方
//
// UI は remoteview.js、接続そのものは backend.js → Rust remote.rs。

import { isValidHost } from './remotepath.js';

export const STORAGE_KEY = 'tana.remotes';
export const MAX_RECENT = 10;

/**
 * @param {{recent?: string[], lastPath?: Record<string,string>}} [initial]
 */
export function createRemotes(initial = {}) {
  let recent = sanitizeRecent(initial.recent);
  let lastPath = sanitizeLastPath(initial.lastPath);
  const writable = new Map();
  const subs = new Set();
  const emit = () => subs.forEach((f) => f());

  return {
    recent: () => recent.slice(),
    lastPath: (host) => lastPath[host] || '',
    /** 開いた接続先を最近の先頭へ（重複は除き MAX_RECENT 件まで）。 */
    touch(host, path) {
      if (!isValidHost(host)) return;
      recent = [host, ...recent.filter((h) => h !== host)].slice(0, MAX_RECENT);
      if (typeof path === 'string' && path) lastPath = { ...lastPath, [host]: path };
      emit();
    },
    forget(host) {
      recent = recent.filter((h) => h !== host);
      lastPath = Object.fromEntries(Object.entries(lastPath).filter(([h]) => h !== host));
      emit();
    },
    isWritable: (host) => writable.get(host) === true,
    setWritable(host, on) {
      writable.set(host, on === true);
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    toJSON: () => ({ recent: recent.slice(), lastPath: { ...lastPath } }),
    /**
     * 最近の接続先を置き換える（別ウィンドウの変更を取り込む）。書き込み許可は
     * ウィンドウごとの同意なので引き継がない。同じ内容なら何もしない
     */
    replace(data) {
      const o = data || {};
      const r = sanitizeRecent(o.recent);
      const lp = sanitizeLastPath(o.lastPath);
      if (JSON.stringify([r, lp]) === JSON.stringify([recent, lastPath])) return;
      recent = r;
      lastPath = lp;
      emit();
    },
  };
}

function sanitizeRecent(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const h of list) {
    if (isValidHost(h) && !out.includes(h)) out.push(h);
  }
  return out.slice(0, MAX_RECENT);
}

function sanitizeLastPath(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [h, p] of Object.entries(obj)) {
    if (isValidHost(h) && typeof p === 'string') out[h] = p;
  }
  return out;
}

/**
 * 接続画面の候補を並べる: 最近使った → 接続中 → ~/.ssh/config（重複は先勝ち）。
 * @param {{recent?: string[], connected?: string[], configured?: string[]}} src
 * @returns {Array<{host: string, source: 'recent'|'connected'|'config'}>}
 */
export function hostCandidates({ recent = [], connected = [], configured = [] } = {}) {
  const out = [];
  const seen = new Set();
  const add = (list, source) => {
    for (const host of list || []) {
      if (!isValidHost(host) || seen.has(host)) continue;
      seen.add(host);
      out.push({ host, source });
    }
  };
  add(recent, 'recent');
  add(connected, 'connected');
  add(configured, 'config');
  return out;
}

/**
 * 接続画面の入力（接続先・パス）から開く場所の URI を作る。
 * パスが空なら相手のホーム、`~/x` はホーム基準、それ以外は絶対パスとして扱う。
 * @returns {string|null} 接続先が不正なら null
 */
export function targetUri(host, path) {
  const h = String(host || '').trim();
  if (!isValidHost(h)) return null;
  let p = String(path || '').trim();
  if (!p || p === '~') return `sftp://${h}`;
  if (p.startsWith('~/')) return `sftp://${h}/${p}`;
  if (!p.startsWith('/')) p = `/~/${p}`; // 相対はホーム基準（ssh/sftp の慣習）
  return `sftp://${h}${p}`;
}

export function loadStoredRemotes(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function storeRemotes(data, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 保存できなくても動作は続ける
  }
}
