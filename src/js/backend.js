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
