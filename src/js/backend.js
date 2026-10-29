// backend.js — Tauri invoke の抽象化レイヤー
// テスト環境やブラウザ単体では Tauri が無いため、安全にフォールバックする。
// リモートの場所（`sftp://HOST/path`, FR-20）は、同じ関数のままここで remote_* コマンドへ
// 振り分ける。呼び出し側（ペイン・プレビュー・ファイル操作）はローカルと区別しなくてよい。

import { isRemote, describeRemoteError, remoteParent } from './core/remotepath.js';

function getInvoke() {
  if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core) {
    return window.__TAURI__.core.invoke;
  }
  return null;
}

/**
 * デスクトップ（Tauri webview）で動作しているかを返す。
 * アップデータのように Tauri 専用のプラグインを触る前のガードに使う。
 */
export function isDesktop() {
  return getInvoke() !== null;
}

/**
 * Tauri コマンドを呼び出す。Tauri 不在時は null を返す。
 * 引数は Rust の snake_case を JS では camelCase で渡す（Tauri v2 の仕様）。
 */
export async function invoke(cmd, args = {}) {
  const fn = getInvoke();
  if (!fn) return null;
  return fn(cmd, args);
}

/**
 * リモート操作を呼ぶ。失敗は人が読む文言（READ_ONLY の言い換え等）にして投げ直す。
 * 衝突の "EXISTS" はそのまま残る（fileops の3択に使う）。
 */
async function remoteInvoke(cmd, args = {}) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    throw new Error(describeRemoteError(e), { cause: e });
  }
}

/** ディレクトリのエントリ一覧を取得する (list_dir コマンド) */
export async function listDir(path) {
  const entries = isRemote(path)
    ? await remoteInvoke('remote_list_dir', { path })
    : await invoke('list_dir', { path });
  return entries || [];
}

/** 親ディレクトリのパスを取得する (parent_dir コマンド)。ルート/不在時は null */
export async function parentDir(path) {
  if (isRemote(path)) return remoteParent(path);
  return invoke('parent_dir', { path });
}

/** ディレクトリの安価な署名を取得する (dir_signature コマンド, FR-19 自動更新)。 */
export async function dirSignature(path) {
  const sig = isRemote(path)
    ? await invoke('remote_dir_signature', { path })
    : await invoke('dir_signature', { path });
  return typeof sig === 'number' ? sig : 0;
}

/** 「場所(Places)」一覧を取得する (list_places コマンド, FR-07)。Tauri 不在時は [] */
export async function listPlaces() {
  const places = await invoke('list_places');
  return places || [];
}

/**
 * 現在ディレクトリ配下を検索する (search_dir コマンド, FR-18)。名前一致 + 内容一致。
 * Tauri 不在時は []。引数は Rust snake_case を camelCase で渡す（Tauri v2）。
 */
export async function searchDir(
  dir,
  query,
  { caseInsensitive = true, includeHidden = false, regex = false, searchContent = false } = {},
  onHit,
) {
  const fn = getInvoke();
  if (!fn) return 0; // Tauri 不在（テスト/ブラウザ）
  const { Channel } = await import('@tauri-apps/api/core');
  const channel = new Channel();
  if (onHit) channel.onmessage = (hit) => onHit(hit);
  // ヒットは channel にストリーミングされ、戻り値は総ヒット数（完了時）。
  return fn('search_dir', {
    onHit: channel,
    dir,
    query,
    caseInsensitive,
    includeHidden,
    regex,
    searchContent,
  });
}

/** 実行中の検索を中断する (cancel_search コマンド, FR-18)。 */
export async function cancelSearch() {
  return invoke('cancel_search');
}

/**
 * アプリ内更新を完了できる環境かを問い合わせる (update_env コマンド)。
 * Tauri 不在（テスト/ブラウザ）では null。判定は updater_env.rs 側。
 */
export async function updateEnv() {
  return invoke('update_env');
}

// ===== WSL 連携 (FR-13 の WSL 拡張) =====

/**
 * WSL 上で Windows アプリを起動できるかを問い合わせる (wsl_info コマンド)。
 * Tauri 不在（テスト/ブラウザ）や非 WSL では available:false。
 */
export async function wslInfo() {
  return invoke('wsl_info');
}

/** Linux パスに対応する Windows パスを返す (windows_path コマンド)。 */
export async function windowsPath(path) {
  return invoke('windows_path', { path });
}

/** Windows 側で開く (open_in_windows コマンド)。app 省略で Windows の既定アプリ。 */
export async function openInWindows(path, app = null) {
  return invoke('open_in_windows', { path, app });
}

/** エクスプローラーで選択表示する (reveal_in_windows コマンド)。 */
export async function revealInWindows(path) {
  return invoke('reveal_in_windows', { path });
}

/** プレビュー用データを取得する (read_preview コマンド, FR-09)。Tauri 不在時は null */
export async function readPreview(path, maxBytes) {
  if (isRemote(path)) return remoteInvoke('remote_read_preview', { path, maxBytes });
  return invoke('read_preview', { path, maxBytes });
}

/**
 * ファイルパスを webview で表示可能な asset URL に変換する（画像プレビュー用）。
 * Tauri 不在（テスト/ブラウザ）ではパスをそのまま返す。
 */
export function assetUrl(path) {
  try {
    if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core) {
      return window.__TAURI__.core.convertFileSrc(path);
    }
  } catch {
    // fall through
  }
  return path;
}

/**
 * 画像プレビューの表示元。リモートは手元の一時フォルダへ取得してから asset URL にする
 * （取得済みで変化が無ければ取り直さない）。
 */
export async function previewSrc(path) {
  if (!isRemote(path)) return assetUrl(path);
  const local = await remoteInvoke('remote_fetch', { path });
  return local ? assetUrl(local) : null;
}

/** アプリのバージョンを取得する (app_version コマンド)。Tauri 不在時は null */
export async function appVersion() {
  return invoke('app_version');
}

/** ホームディレクトリのパスを取得する (home_dir コマンド) */
export async function homeDir() {
  return invoke('home_dir');
}

/** プロセスのカレントディレクトリを取得する (current_dir コマンド)。相対パス解決用 */
export async function currentDir() {
  return invoke('current_dir');
}

/** 起動時 CLI 引数 path（開くディレクトリ）を取得する。無ければ null */
export async function getCliPath() {
  try {
    const mod = await import('@tauri-apps/plugin-cli');
    const matches = await mod.getMatches();
    const v = matches && matches.args && matches.args.path && matches.args.path.value;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

// ===== ファイル操作 (FR-02, FR-03) =====
// Rust が Err を返すと invoke は reject する。呼び出し側で捕捉する。

/** dest_dir 配下へコピー。destName で宛先名指定可。既存かつ overwrite=false なら "EXISTS" で reject */
export async function copyPath(src, destDir, destName = null, overwrite = false) {
  if (isRemote(src) || isRemote(destDir)) {
    return remoteInvoke('remote_copy', { src, destDir, destName, overwrite });
  }
  return invoke('copy_path', { src, destDir, destName, overwrite });
}

/** dest_dir 配下へ移動。destName で宛先名指定可。既存かつ overwrite=false なら "EXISTS" で reject */
export async function movePath(src, destDir, destName = null, overwrite = false) {
  if (isRemote(src) || isRemote(destDir)) {
    return remoteInvoke('remote_move', { src, destDir, destName, overwrite });
  }
  return invoke('move_path', { src, destDir, destName, overwrite });
}

/** dest_dir 内で衝突しないベース名を取得（既存なら "name (1).ext" …） */
export async function uniqueName(destDir, name) {
  if (isRemote(destDir)) return remoteInvoke('remote_unique_name', { destDir, name });
  return invoke('unique_name', { destDir, name });
}

/** OS のゴミ箱へ移動（リモートにゴミ箱は無い。fileops が完全削除へ回す） */
export async function deleteToTrash(path) {
  if (isRemote(path)) throw new Error('リモートにはゴミ箱がありません');
  return invoke('delete_to_trash', { path });
}

/** 完全削除 */
export async function deletePermanent(path) {
  if (isRemote(path)) return remoteInvoke('remote_delete', { path });
  return invoke('delete_permanent', { path });
}

/** 同じ親内で名前変更。既存なら "EXISTS" で reject */
export async function renamePath(path, newName) {
  if (isRemote(path)) return remoteInvoke('remote_rename', { path, newName });
  return invoke('rename_path', { path, newName });
}

/** parent 配下に新規ディレクトリ作成。既存なら "EXISTS" で reject */
export async function makeDir(parent, name) {
  if (isRemote(parent)) return remoteInvoke('remote_make_dir', { parent, name });
  return invoke('make_dir', { parent, name });
}

/** parent 配下に空のファイルを作成。既存なら "EXISTS" で reject */
export async function makeFile(parent, name) {
  if (isRemote(parent)) return remoteInvoke('remote_make_file', { parent, name });
  return invoke('make_file', { parent, name });
}

/** 確認ダイアログ。Tauri 不在時は window.confirm にフォールバック */
export async function confirmDialog(message) {
  try {
    const mod = await import('@tauri-apps/plugin-dialog');
    return await mod.confirm(message, { title: 'Tana', kind: 'warning' });
  } catch {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
    return false;
  }
}

// ===== リモート接続 (FR-20) =====
// 接続は ssh 越しの SFTP（Rust remote.rs）。最初に使ったときに自動で張られるので、
// 明示的に繋ぐのは接続画面から開くときだけ。

/** 接続してホームの URI（sftp://HOST/home/you）を返す。 */
export async function remoteConnect(host) {
  return remoteInvoke('remote_connect', { host });
}

/** 接続を切る（相手側の sftp-server も終わる）。 */
export async function remoteDisconnect(host) {
  return invoke('remote_disconnect', { host });
}

/** 接続中の一覧 [{host, writable, home}]。Tauri 不在時は []。 */
export async function remoteSessions() {
  return (await invoke('remote_sessions')) || [];
}

/** 未登録のホスト鍵を登録して繋ぐことを許す（利用者が確認した後に呼ぶ）。 */
export async function remoteTrustHost(host) {
  return invoke('remote_trust_host', { host });
}

/** 接続先への書き込みを許可/禁止する（既定は閲覧のみ）。 */
export async function remoteSetWritable(host, writable) {
  return invoke('remote_set_writable', { host, writable });
}

/** ~/.ssh/config の Host 名一覧。Tauri 不在時は []。 */
export async function remoteHosts() {
  return (await invoke('remote_hosts')) || [];
}

/** `sftp://HOST` や `sftp://HOST/~/x` を絶対パスの URI に解決する。 */
export async function remoteResolve(path) {
  return remoteInvoke('remote_resolve', { path });
}

/** リモートのファイルを手元の一時フォルダへ取得し、そのパスを返す（既定アプリで開く用）。 */
export async function remoteFetch(path) {
  return remoteInvoke('remote_fetch', { path });
}

// ===== ダウンロード型拡張 (Fude と同じ構成。extensions.rs) =====

/** 拡張が入っているか。{installed, version}。Tauri 不在時は null */
export async function extensionStatus(id) {
  return invoke('extension_status', { id });
}

/** 導入済み拡張のファイルの中身（テキスト）。 */
export async function readExtensionFile(id, rel) {
  return invoke('read_extension_file', { id, rel });
}

/** 拡張を削除する。 */
export async function uninstallExtension(id) {
  return invoke('uninstall_extension', { id });
}

/**
 * 拡張をダウンロード・検証・配置する。進み具合は onProgress(progress, total) に届く。
 * 失敗は reject（文言は人が読めるもの）。
 */
export async function installExtension(id, onProgress) {
  const fn = getInvoke();
  if (!fn) throw new Error('この環境では拡張機能を入れられません');
  const { Channel } = await import('@tauri-apps/api/core');
  const channel = new Channel();
  if (onProgress) channel.onmessage = (p) => onProgress(p.progress, p.total);
  return fn('install_extension', { id, onProgress: channel });
}

/**
 * ファイルの中身をバイト列（ArrayBuffer）で読む（PDF プレビュー用）。
 * リモートは手元の一時フォルダへ取得してから読む。上限超過は "TOO_LARGE" で reject。
 */
export async function readFileBytes(path, maxBytes) {
  const local = isRemote(path) ? await remoteInvoke('remote_fetch', { path }) : path;
  if (!local) throw new Error('読めませんでした');
  return invoke('read_file_bytes', { path: local, maxBytes });
}
