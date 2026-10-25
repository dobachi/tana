// mdimages.js — Markdown プレビュー中の画像参照を解決する (FR-09, FR-20)。
//
// `![](img/a.png)` の相対パスは md ファイルの場所が基準。手元は asset protocol、
// リモート（`sftp://…`）は手元へ取り寄せた写しを表示する（どちらも backend.previewSrc）。
// 外部 URL（http/https 等）は解決しない（CSP でも遮断。閲覧が外へ漏れないように）。

import { normalizePath, parentPath } from './pathnav.js';
import { formatRemote, parseRemote } from './remotepath.js';

/** 一つのプレビューで解決する画像の上限（リモートの取り寄せが際限なく走らないように）。 */
export const MAX_MD_IMAGES = 30;

/**
 * 画像の参照先を、表示に使う場所へ変換する。
 * @param {string} mdPath 表示中の md ファイル（ローカルの絶対パス or `sftp://…`）
 * @param {string} src Markdown に書かれた参照
 * @returns {{path: string}|{url: string}|null} path=ファイル（要解決）, url=そのまま使える, null=表示しない
 */
export function resolveImageRef(mdPath, src) {
  const raw = String(src || '').trim();
  if (!raw) return null;
  if (/^data:image\//i.test(raw)) return { url: raw };
  if (raw.startsWith('//')) return null; // プロトコル相対 = 外部
  const remote = parseRemote(mdPath);
  const winDrive = /^[A-Za-z]:[/\\]/.test(raw);
  if (!winDrive && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return null; // http: file: sftp: など

  let ref = raw.replace(/[?#].*$/, '');
  try {
    ref = decodeURI(ref);
  } catch {
    // 壊れた %xx はそのまま
  }
  if (!ref) return null;

  if (remote) {
    if (winDrive) return null;
    const dir = remote.path.replace(/\/[^/]*$/, '') || '/';
    const abs = ref.startsWith('/') ? ref : `${dir}/${ref}`;
    return { path: formatRemote(remote.host, posixNormalize(abs)) };
  }
  if (winDrive || ref.startsWith('/') || ref.startsWith('\\')) return { path: normalizePath(ref) };
  const dir = parentPath(mdPath);
  if (!dir) return null;
  return { path: normalizePath(`${dir}/${ref}`) };
}

function posixNormalize(path) {
  const out = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

/**
 * 描画済み Markdown の `<img data-md-src>` に表示元を入れる。
 * 取り寄せは一枚ずつ（リモートの接続を詰まらせない）。`isCurrent()` が偽になったら打ち切る。
 * @param {HTMLElement} container
 * @param {string} mdPath
 * @param {{toSrc: (path: string) => Promise<string|null>, isCurrent?: () => boolean}} deps
 */
export async function resolveMarkdownImages(container, mdPath, { toSrc, isCurrent = () => true }) {
  const imgs = Array.from(container.querySelectorAll('img[data-md-src]'));
  let fetched = 0;
  for (const img of imgs) {
    if (!isCurrent()) return;
    const ref = resolveImageRef(mdPath, img.getAttribute('data-md-src'));
    if (ref && 'url' in ref) {
      img.src = ref.url;
      continue;
    }
    if (!ref || fetched >= MAX_MD_IMAGES) {
      markMissing(img);
      continue;
    }
    fetched += 1;
    const url = await Promise.resolve()
      .then(() => toSrc(ref.path))
      .catch(() => null);
    if (!isCurrent()) return;
    if (url) img.src = url;
    else markMissing(img);
  }
}

function markMissing(img) {
  img.classList.add('md-img-missing');
  if (!img.title) img.title = img.getAttribute('alt') || img.getAttribute('data-md-src') || '';
}
