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
  // o は「開く」。1..9 は設定に登録した外部アプリのスロット (extapps.js)、
  // a は都度入力。三打鍵は既存の二打鍵モデルに無いので、登録アプリへは数字で直行する。
  o: {
    o: 'open:app',
    r: 'open:reveal',
    a: 'open:with:ask',
    // WSL 専用。非 WSL では「使えない」と理由を出す（黙って無反応にしない）。
    w: 'open:windows',
    e: 'open:explorer',
    1: 'open:with:1',
    2: 'open:with:2',
    3: 'open:with:3',
    4: 'open:with:4',
    5: 'open:with:5',
    6: 'open:with:6',
    7: 'open:with:7',
    8: 'open:with:8',
    9: 'open:with:9',
  },
};

/** 各プレフィックス発動時に出すヒント文言。 */
export const PREFIX_HINTS = {
  s: '並び替え: n=名前 / s=サイズ / m=更新日時 / e=拡張子 / r=反転',
  t: 'タブ: h=左へ / l=右へ',
  y: 'コピー: p=パス / n=名前 / d=現在地のパス',
  o: '開く: o=既定アプリ / r=ファイルマネージャ / 1-9=登録した外部アプリ / a=別のアプリ…',
};

/** WSL のときだけヒントに足す案内（非 WSL では出しても使えないので出さない）。 */
const WSL_HINT_SUFFIX = { o: ' / w=Windows の既定アプリ / e=エクスプローラー' };

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

/**
 * プレフィックスのヒント文言。
 * @param {string} prefix
 * @param {{wsl?: boolean}} [opts] wsl:true で WSL 専用キーの案内を足す
 */
export function prefixHint(prefix, opts = {}) {
  const base = PREFIX_HINTS[prefix] || '';
  if (!base || !opts.wsl) return base;
  return base + (WSL_HINT_SUFFIX[prefix] || '');
}
