// remotespec.js — リモートの場所を 1 行で書いた指定を読む（Fude / Tana 共通の書き方）。純粋・DOM 非依存。
//
// AI に決まった形で出させてコピペで開く用途を想定し、次の形を受け付ける:
//   ssh://[user@]host[:22][/path]     正式な形（sftp:// と remote:// も同じ扱い）
//   [user@]host:/abs/path             scp と同じ簡易形（host:~/x も可。"localhost:8080" や
//                                     時刻のような誤読を避けるため、相対パスは受けない）
// path は "/abs" / "~/x" / ""（= ホーム）。URL 形は %xx をデコードし、空白もそのまま受ける。`#…` `?…` は無視。
// 前後の空白・引用符・バッククォート・<>、行頭の箇条書き記号、``` の行は取り除き、
// 最初に読めた行を使う。ポートは ~/.ssh/config に Host を作って指定してもらう（22 以外は不可）。

const URL_RE =
  /^(?:ssh|sftp|remote):\/\/(?:([^@/\s]+)@)?([^/:\s#?]+)(?::(\d+))?(\/[^#?]*)?(?:[?#]\S*)?$/i;
// host は 2 文字以上（"C:\x" "C:/x" のようなドライブ名を拾わないため）
// path は空白を含んでよい（行の残り全部）。"/" か "~" で始まるものだけ（"Note:" のような文を拾わない）
const SCP_RE = /^(?:([^@\s:/\\]+)@)?([A-Za-z0-9][A-Za-z0-9._-]+):((?:\/(?!\/)|~)[^\\]*)$/;
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USER_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 1 行から飾り（引用符・バッククォート・<>・箇条書き）を外す */
function stripLine(line) {
  let s = String(line).trim();
  s = s.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
  for (;;) {
    const t = s
      .replace(/^[`'"<「『]+/, '')
      .replace(/[`'">」』]+$/, '')
      .trim();
    if (t === s) return s;
    s = t;
  }
}

/** URL 形の path（"/~/x" → "~/x"、"/~" → "~"、無し → ""） */
function urlPath(p) {
  if (!p || p === '') return '';
  const d = decode(p);
  if (d === '/~' || d === '/~/') return '~';
  if (d.startsWith('/~/')) return d.slice(1);
  return d;
}

function build(user, host, port, path) {
  if (!HOST_RE.test(host) || host.length > 253) return null;
  if (user && !USER_RE.test(user)) return null;
  if (port && port !== '22') {
    return {
      error: `ポート ${port} は直接指定できません。~/.ssh/config に Host を作り、その名前で指定してください`,
    };
  }
  return { host: user ? `${user}@${host}` : host, path };
}

/**
 * 1 行の指定を読む。
 * @param {string} text 貼り付けた文字列（複数行なら最初に読めた行）
 * @returns {{host: string, path: string} | {error: string} | null}
 *   host は ssh に渡す宛先（user@host を含む）、path は "/abs" / "~/x" / ""（ホーム）。
 *   リモートの指定でなければ null
 */
export function parseRemoteSpec(text) {
  if (typeof text !== 'string') return null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) continue;
    const s = stripLine(raw);
    if (!s) continue;
    let m = URL_RE.exec(s);
    if (m) return build(m[1], m[2], m[3], urlPath(m[4]));
    m = SCP_RE.exec(s);
    if (m) return build(m[1], m[2], null, m[3]);
  }
  return null;
}

/** 正式な形（ssh://host/path）で書く。AI への指示例やコピー用 */
export function formatRemoteSpec(host, path = '') {
  const p = !path ? '' : path.startsWith('/') ? path : `/${path}`;
  return `ssh://${host}${p}`;
}

/**
 * クリップボードの中身から、入力欄に先に入れておく文字列を作る（正式な形に直す）。
 * リモートの指定でない・ポート指定で断るものは null（今の場所を出す従来どおりにする）。
 */
export function prefillFromClipboard(text) {
  const r = parseRemoteSpec(text);
  return r && !r.error ? formatRemoteSpec(r.host, r.path) : null;
}
