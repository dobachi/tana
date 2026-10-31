// fudehandoff.js — リモートのファイルを Fude にリモートのまま渡すかの判定（純粋関数）
//
// リモートのファイルを開くと、手元の一時フォルダへ写してから既定のアプリで開く。
// Fude でその写しを編集・保存してもホストのファイルは変わらない（実機で「保存されない」
// と報告された）。Fude は ssh 越しにそのまま編集できるので、Fude で開く場面では
// `ssh://host/path` を渡す。起動は Rust 側（fude.rs）。

import { isRemote, parseRemote } from './remotepath.js';
import { formatRemoteSpec } from './remotespec.js';

const MARKDOWN = /\.(md|markdown|mdown|mkd|qmd|mdx)$/i;

/** Markdown のファイル名か（既定のアプリで開くとき Fude へ回す対象） */
export function isMarkdownName(path) {
  return typeof path === 'string' && MARKDOWN.test(path);
}

/**
 * 「別のアプリで開く」に登録されたアプリが Fude か。
 * コマンドの末尾が fude / fude.exe / Fude.app、または表示名が Fude。
 * @param {{name?: string, command?: string}|null} spec
 */
export function isFudeApp(spec) {
  if (!spec) return false;
  const command = String(spec.command || '').trim();
  const name = String(spec.name || '').trim();
  return /(^|[\\/])fude(\.exe|\.app)?$/i.test(command) || /^fude$/i.test(name);
}

/**
 * Fude へ渡す場所（`ssh://host/path`）。渡さない場面は null。
 *
 * - 開く操作（kind 'open'）で、リモートのファイルのとき
 * - アプリの指定が無ければ Markdown のときだけ（既定のアプリで開く代わり）
 * - アプリの指定があれば、それが Fude のときだけ
 *
 * @param {{kind: string, path: string, spec?: object|null}} p
 * @returns {string|null}
 */
export function fudeHandoffUri({ kind, path, spec = null }) {
  if (kind !== 'open' || !isRemote(path)) return null;
  if (spec ? !isFudeApp(spec) : !isMarkdownName(path)) return null;
  const r = parseRemote(path);
  if (!r || !r.path || r.path === '/') return null;
  return formatRemoteSpec(r.host, r.path);
}
