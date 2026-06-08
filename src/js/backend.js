// backend.js — Tauri invoke の抽象化レイヤー
// テスト環境やブラウザ単体では Tauri が無いため、安全にフォールバックする。

function getInvoke() {
  if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core) {
    return window.__TAURI__.core.invoke;
  }
  return null;
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

/** ホームディレクトリのパスを取得する (home_dir コマンド) */
export async function homeDir() {
  return invoke('home_dir');
}

// ===== ファイル操作 (FR-02, FR-03) =====
// Rust が Err を返すと invoke は reject する。呼び出し側で捕捉する。

/** dest_dir 配下へコピー。既存かつ overwrite=false なら "EXISTS" で reject */
export async function copyPath(src, destDir, overwrite = false) {
  return invoke('copy_path', { src, destDir, overwrite });
}

/** dest_dir 配下へ移動。既存かつ overwrite=false なら "EXISTS" で reject */
export async function movePath(src, destDir, overwrite = false) {
  return invoke('move_path', { src, destDir, overwrite });
}

/** OS のゴミ箱へ移動 */
export async function deleteToTrash(path) {
  return invoke('delete_to_trash', { path });
}

/** 完全削除 */
export async function deletePermanent(path) {
  return invoke('delete_permanent', { path });
}

/** 新規ディレクトリ作成 */
export async function makeDir(path) {
  return invoke('make_dir', { path });
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
