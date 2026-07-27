// keyprefix.js — 二打鍵（プレフィックス）ショートカットの純粋なマッピング。
//
// 低頻度 or キーボードから直行しづらい操作を、リーダーキー + 1キーの二打鍵に
// まとめる（並び替え s は従来からこの方式）。ここは「(prefix, key) → アクションID」
// の対応とヒント文言だけを持つ純粋ロジックで、実際の実行は app 側。

/** リーダーキー → 名前（デバッグ/表示用） */
export const PREFIX_LEADERS = {
  s: 'sort', // 並び替え
  t: 'tab', // タブ操作
  y: 'copy', // ヤンク（コピー）
  o: 'open', // 開く/表示
};

// (prefix)(key) → アクションID。key は小文字で引く。
const MAP = {
  s: { n: 'sort:name', s: 'sort:size', m: 'sort:modified', e: 'sort:ext', r: 'sort:reverse' },
  t: { h: 'tab:left', l: 'tab:right' },
  y: { p: 'copy:path', n: 'copy:name', d: 'copy:dir' },
  o: { o: 'open:app', r: 'open:reveal' },
};

/** 各プレフィックス発動時に出すヒント文言。 */
export const PREFIX_HINTS = {
  s: '並び替え: n=名前 / s=サイズ / m=更新日時 / e=拡張子 / r=反転',
  t: 'タブ: h=左へ / l=右へ',
  y: 'コピー: p=パス / n=名前 / d=現在地のパス',
  o: '開く: o=外部アプリ / r=ファイルマネージャで表示',
};

/** key がプレフィックスのリーダーか。 */
export function isPrefixLeader(key) {
  return (
    typeof key === 'string' &&
    Object.prototype.hasOwnProperty.call(PREFIX_LEADERS, key.toLowerCase())
  );
}

/** (prefix, key) を確定アクションIDに解決する。該当なしは null。 */
export function resolvePrefixAction(prefix, key) {
  const m = MAP[prefix];
  if (!m || typeof key !== 'string') return null;
  return m[key.toLowerCase()] || null;
}

/** プレフィックスのヒント文言。 */
export function prefixHint(prefix) {
  return PREFIX_HINTS[prefix] || '';
}
