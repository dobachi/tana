// keyguide.js — 画面下に出しっぱなしにできる「キーガイド」の中身を決める純粋ロジック。
//
// 二打鍵（o → o など）や F キーは忘れやすいので、今の状況で効く主なキーを短く並べる。
//   - 二打鍵の途中（リーダーを押した直後）: その続きのキー一覧（keyprefix.js のヒントが真実源）
//   - お気に入りの一覧にいるとき: お気に入りのキー
//   - ペイン: 主なキー + 二打鍵の入口。操作モードではファイル操作のキーも出す
// 表示のオン/オフは localStorage に保存する（既定はオフ）。DOM 描画は app 側。

import { prefixHint, PREFIX_LEADERS } from './keyprefix.js';

export const KEYGUIDE_KEY = 'tana.keyguide';

/** 保存されたオン/オフ。既定はオフ（既存の利用者の画面を勝手に変えない） */
export function loadKeyGuide(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    return !!storage && storage.getItem(KEYGUIDE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function storeKeyGuide(
  on,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
) {
  try {
    if (storage) storage.setItem(KEYGUIDE_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても表示の切り替え自体は効かせる
  }
}

/**
 * 「並び替え: n=名前 / s=サイズ」形式のヒントを {key, label} の列にする。
 * @param {string} hint
 * @returns {{title: string, items: Array<{key: string, label: string}>}}
 */
export function parsePrefixHint(hint) {
  if (typeof hint !== 'string' || !hint) return { title: '', items: [] };
  const colon = hint.indexOf(': ');
  const title = colon >= 0 ? hint.slice(0, colon) : '';
  const body = colon >= 0 ? hint.slice(colon + 2) : hint;
  const items = [];
  for (const part of body.split(' / ')) {
    // 先頭 1 文字は '=' のこともある（'+=大きく' の '+' ではなく '=' キー等）ので 2 文字目から探す
    const eq = part.indexOf('=', 1);
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const label = part.slice(eq + 1).trim();
    if (key && label) items.push({ key, label });
  }
  return { title, items };
}

/** 二打鍵の入口（リーダー）の短い名前。表示順もこの順 */
const LEADER_LABELS = [
  ['o', '開く…'],
  ['y', 'コピー…'],
  ['s', '並び替え…'],
  ['f', '絞り込み…'],
  ['v', '表示…'],
  ['t', 'タブ…'],
];

const PANE_BASIC = [
  { key: 'Enter', label: '開く' },
  { key: 'H', label: '親へ' },
  { key: 'Tab', label: 'ペイン切替' },
  { key: 'Space', label: '選択' },
  { key: '/', label: '検索' },
  { key: 'Ctrl+L', label: 'パス入力' },
];

const FILE_OPS = [
  { key: 'F5', label: 'コピー' },
  { key: 'F6', label: '移動' },
  { key: 'F2', label: '名前変更' },
  { key: 'F7', label: '新フォルダ' },
  { key: 'Del', label: 'ゴミ箱へ' },
  { key: 'Ctrl+V', label: '貼り付け' },
];

const FAVORITES = [
  { key: 'j/k', label: '上下' },
  { key: 'Enter', label: '開く' },
  { key: 'l/h', label: '展開/閉じる' },
  { key: 't', label: 'タグ' },
  { key: 'Alt+↑↓', label: '並べ替え' },
  { key: 'Esc', label: 'ペインへ' },
];

/**
 * 今の状況で出すキー一覧。
 * @param {{prefix?: string|null, focus?: 'pane'|'favorites'|string, safe?: boolean, wsl?: boolean}} state
 * @returns {{title: string, items: Array<{key: string, label: string}>}}
 */
export function keyGuideItems(state = {}) {
  const { prefix, focus, safe = true, wsl = false } = state;
  if (prefix && Object.prototype.hasOwnProperty.call(PREFIX_LEADERS, prefix)) {
    const parsed = parsePrefixHint(prefixHint(prefix, { wsl }));
    return {
      title: `${prefix} → ${parsed.title}`,
      items: [...parsed.items, { key: 'Esc', label: 'やめる' }],
    };
  }
  if (focus === 'favorites') {
    return { title: 'お気に入り', items: FAVORITES.slice() };
  }
  const items = [...PANE_BASIC, ...LEADER_LABELS.map(([key, label]) => ({ key, label }))];
  if (safe) {
    items.push({ key: 'Ctrl+Shift+Space', label: '操作モードへ' });
  } else {
    items.push(...FILE_OPS, { key: 'Ctrl+Shift+Space', label: '安全モードへ' });
  }
  items.push({ key: '?', label: 'すべてのキー' });
  return { title: '', items };
}
