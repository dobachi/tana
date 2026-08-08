// backend.js — Tauri invoke の抽象化レイヤー
// テスト環境やブラウザ単体では Tauri が無いため、安全にフォールバックする。

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

/** ディレクトリのエントリ一覧を取得する (list_dir コマンド) */
export async function listDir(path) {
  const entries = await invoke('list_dir', { path });
  return entries || [];
}

/** 親ディレクトリのパスを取得する (parent_dir コマンド)。ルート/不在時は null */
export async function parentDir(path) {
  return invoke('parent_dir', { path });
}

/** ディレクトリの安価な署名を取得する (dir_signature コマンド, FR-19 自動更新)。 */
export async function dirSignature(path) {
  const sig = await invoke('dir_signature', { path });
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

/** アプリのバージョンを取得する (app_version コマンド)。Tauri 不在時は null */
export async function appVersion() {
  return invoke('app_version');
}

/** ホームディレクトリのパスを取得する (home_dir コマンド) */
export async function homeDir() {
  return invoke('home_dir');
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
  return invoke('copy_path', { src, destDir, destName, overwrite });
}

/** dest_dir 配下へ移動。destName で宛先名指定可。既存かつ overwrite=false なら "EXISTS" で reject */
export async function movePath(src, destDir, destName = null, overwrite = false) {
  return invoke('move_path', { src, destDir, destName, overwrite });
}

/** dest_dir 内で衝突しないベース名を取得（既存なら "name (1).ext" …） */
export async function uniqueName(destDir, name) {
  return invoke('unique_name', { destDir, name });
}

/** OS のゴミ箱へ移動 */
export async function deleteToTrash(path) {
  return invoke('delete_to_trash', { path });
}

/** 完全削除 */
export async function deletePermanent(path) {
  return invoke('delete_permanent', { path });
}

/** 同じ親内で名前変更。既存なら "EXISTS" で reject */
export async function renamePath(path, newName) {
  return invoke('rename_path', { path, newName });
}

/** parent 配下に新規ディレクトリ作成。既存なら "EXISTS" で reject */
export async function makeDir(parent, name) {
  return invoke('make_dir', { parent, name });
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
