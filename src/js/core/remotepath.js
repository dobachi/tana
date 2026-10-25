// remotepath.js — リモートの場所 `sftp://HOST/path` の純粋な扱い (FR-20)。
//
// アプリ内ではリモートの場所を文字列 `sftp://HOST/絶対パス` で表す（Rust の remote.rs と同じ形）。
// ローカルのパスと同じようにペイン・タブ・お気に入り・セッションへ流せるよう、
// 判定・親・ブレッドクラム・表示名・エラー文言をここに集める。DOM/Tauri 非依存。

export const SCHEME = 'sftp://';

/** ssh に渡してよい接続先か（Rust の valid_host と同じ規則）。 */
export function isValidHost(host) {
  return (
    typeof host === 'string' &&
    host.length > 0 &&
    host.length <= 255 &&
    !host.startsWith('-') &&
    /^[A-Za-z0-9._\-@:[\]%]+$/.test(host)
  );
}

/** リモートの場所か。 */
export function isRemote(path) {
  return typeof path === 'string' && path.startsWith(SCHEME);
}

/**
 * `sftp://HOST/path` を分解する。リモートでない・接続先が不正なら null。
 * @returns {{host: string, path: string}|null} path は POSIX の絶対パス（空はホーム）
 */
export function parseRemote(uri) {
  if (!isRemote(uri)) return null;
  const rest = uri.slice(SCHEME.length);
  const i = rest.indexOf('/');
  const host = i < 0 ? rest : rest.slice(0, i);
  const path = i < 0 ? '' : rest.slice(i);
  if (!isValidHost(host)) return null;
  return { host, path };
}

/** 接続先とパスから `sftp://HOST/path` を作る。 */
export function formatRemote(host, path = '') {
  const p = !path ? '' : path.startsWith('/') ? path : `/${path}`;
  return `${SCHEME}${host}${p}`;
}

/** 接続先名（リモートでなければ null）。 */
export function remoteHost(uri) {
  const r = parseRemote(uri);
  return r ? r.host : null;
}

/** POSIX パスの `.`/`..`/重複区切りを解決する（ルートより上には登らない）。 */
function normalizePosix(path) {
  const out = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

/**
 * 入力された `sftp://…` を整える。`~` で始まるパスは相手のホーム基準のまま残す
 * （絶対パスへの解決は接続後に Rust の remote_resolve が行う）。
 * @returns {string|null}
 */
export function normalizeRemote(uri) {
  const r = parseRemote(uri);
  if (!r) return null;
  if (!r.path || r.path === '/~' || r.path.startsWith('/~/')) {
    return formatRemote(r.host, r.path.replace(/\/+$/, ''));
  }
  return formatRemote(r.host, normalizePosix(r.path));
}

/** 接続後に Rust でホーム等を解決する必要があるか（`sftp://h` / `sftp://h/~/x`）。 */
export function needsResolve(uri) {
  const r = parseRemote(uri);
  return !!r && (!r.path || r.path === '/~' || r.path.startsWith('/~/'));
}

/** 親の場所（相手のルートでは null）。 */
export function remoteParent(uri) {
  const r = parseRemote(uri);
  if (!r) return null;
  const p = r.path.replace(/\/+$/, '');
  if (!p) return null;
  const i = p.lastIndexOf('/');
  if (i < 0) return null;
  return formatRemote(r.host, i === 0 ? '/' : p.slice(0, i));
}

/**
 * ブレッドクラム用の区切り。先頭は接続先（`k16:` → 相手のルート）。
 * @returns {Array<{name: string, path: string}>}
 */
export function remoteSegments(uri) {
  const r = parseRemote(uri);
  if (!r) return [];
  const segs = [{ name: `${r.host}:`, path: formatRemote(r.host, '/') }];
  let acc = '';
  for (const s of r.path.split('/').filter(Boolean)) {
    acc = `${acc}/${s}`;
    segs.push({ name: s, path: formatRemote(r.host, acc) });
  }
  return segs;
}

/** 人に見せる短い表記（`k16:/home/you`）。タブ名・トーストなどに使う。 */
export function remoteLabel(uri) {
  const r = parseRemote(uri);
  if (!r) return String(uri || '');
  return `${r.host}:${r.path || '~'}`;
}

/**
 * Rust から返ったリモート操作のエラーを人が読む文言へ。
 * `READ_ONLY:<host>` は閲覧のみの接続への書き込み。それ以外はそのまま。
 */
export function describeRemoteError(error) {
  const msg = error && typeof error === 'object' && 'message' in error ? error.message : error;
  const s = msg == null ? '' : String(msg);
  const m = /^READ_ONLY:(.*)$/.exec(s);
  if (m) return readOnlyMessage(m[1]);
  return s;
}

/** 閲覧のみの接続へ書き込もうとしたときの案内。 */
export function readOnlyMessage(host) {
  return `${host} は閲覧のみの接続です（書き込みはリモート接続画面で許可: o → s）`;
}

/**
 * 書き込みの対象（宛先や消す元）のうち、許可されていない接続先を探す。
 * @param {Array<string|null|undefined>} paths 書き込みが起きる場所
 * @param {(host: string) => boolean} isWritable
 * @returns {string|null} 閲覧のみの接続先（無ければ null）
 */
export function readOnlyHostAmong(paths, isWritable) {
  for (const p of paths) {
    const host = remoteHost(p);
    if (host && !isWritable(host)) return host;
  }
  return null;
}
