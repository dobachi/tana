// pathnav.js — パス直接入力 / ブレッドクラム移動の純粋ロジック (FR-12)
//
// DOM にも Tauri にも依存しないので単体テストできる。実際の移動可否
// （存在するか・ディレクトリか）は listDir の成否で判断する。

/** POSIX の "/"、UNC の "\\"、Windows のドライブ（C:\ / C:/）を根とみなす */
function isAbsolute(p) {
  return /^(\/|\\|[A-Za-z]:[/\\])/.test(p);
}

/** 区切りを "/" に統一し、末尾の余分な区切りを落とす（根は残す） */
export function normalizeSeparators(path) {
  const unix = String(path).replace(/\\/g, '/');
  const collapsed = unix.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/') && !/^[A-Za-z]:\/$/.test(collapsed)) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

/**
 * "." と ".." を解決する。根より上には登らない。
 * @param {string} path
 */
export function normalizePath(path) {
  const unix = normalizeSeparators(path);
  const drive = unix.match(/^[A-Za-z]:\//);
  const root = drive ? drive[0] : unix.startsWith('/') ? '/' : '';
  const out = [];
  for (const seg of unix.slice(root.length).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!root) out.push('..');
      continue;
    }
    out.push(seg);
  }
  const joined = root + out.join('/');
  return joined || root || '';
}

/**
 * 入力されたパスを実際に移動できる絶対パスへ変換する。
 *
 * - "~" / "~/sub" はホームへ展開する
 * - 絶対パスはそのまま
 * - 相対パスは現在地から解決する
 * - 前後の空白と、コピペで付きがちな引用符を落とす
 *
 * @param {string} input ユーザーが入力した文字列
 * @param {{home?: string, cwd?: string}} [ctx]
 * @returns {string|null} 移動先の絶対パス。空入力など解決できない場合は null
 */
export function resolveInputPath(input, ctx = {}) {
  if (typeof input !== 'string') return null;
  let raw = input
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
  if (!raw) return null;

  const { home = '', cwd = '' } = ctx;

  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    if (!home) return null;
    const rest = raw.slice(1).replace(/^[/\\]/, '');
    raw = rest ? `${normalizeSeparators(home)}/${rest}` : home;
  } else if (!isAbsolute(raw)) {
    if (!cwd) return null;
    raw = `${normalizeSeparators(cwd)}/${raw}`;
  }
  const resolved = normalizePath(raw);
  return resolved || null;
}

/**
 * ブレッドクラム用にパスを区切る。各要素はその階層までの絶対パスを持つ。
 * @param {string} dir
 * @returns {Array<{name: string, path: string}>}
 */
export function pathSegments(dir) {
  if (!dir || typeof dir !== 'string') return [];
  const path = normalizeSeparators(dir);
  const drive = path.match(/^[A-Za-z]:\//);

  if (drive) {
    const root = drive[0]; // "C:/"
    const segs = [{ name: root.slice(0, 2), path: root }];
    let acc = root;
    for (const s of path.slice(root.length).split('/').filter(Boolean)) {
      acc = acc.endsWith('/') ? `${acc}${s}` : `${acc}/${s}`;
      segs.push({ name: s, path: acc });
    }
    return segs;
  }

  if (path.startsWith('/')) {
    const segs = [{ name: '/', path: '/' }];
    let acc = '';
    for (const s of path.split('/').filter(Boolean)) {
      acc = `${acc}/${s}`;
      segs.push({ name: s, path: acc });
    }
    return segs;
  }

  // 相対パス（通常は来ないが、表示だけは壊さない）
  const segs = [];
  let acc = '';
  for (const s of path.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${s}` : s;
    segs.push({ name: s, path: acc });
  }
  return segs;
}
