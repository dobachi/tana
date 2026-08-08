// wsl.js — WSL(Linux) 上の Tana から「Windows 側のアプリで開く」判断ロジック (FR-13 の WSL 拡張)
//
// Windows アプリを起動できるか（パス変換・interop）は Rust 側 (wsl.rs) が担う。
// ここが決めるのは次の 2 つだけで、DOM も Tauri も触らない純粋モジュール。
//   1. 既定オープン（Enter / ダブルクリック）を Linux 側と Windows 側のどちらへ流すか
//   2. 登録された外部アプリをどちら側で起動するか（target=auto のときの推定）
//
// WSL では Linux 側の GUI アプリ・関連付けが無いことが多く、xdg-open 経由の
// 既定オープンは「開けませんでした」で終わりやすい。そのため WSL と判定できた
// ときの既定は **Windows 側** とし、設定で Linux 側へ戻せるようにする。

/** 起動先。LINUX は「OS 既定の opener 経路」（非 WSL では単にその OS のこと）。 */
export const TARGET = { AUTO: 'auto', LINUX: 'linux', WINDOWS: 'windows' };

/** 設定 UI の選択肢（外部アプリごとの起動先） */
export const APP_TARGETS = [TARGET.AUTO, TARGET.LINUX, TARGET.WINDOWS];

export const TARGET_LABELS = {
  [TARGET.AUTO]: '自動',
  [TARGET.LINUX]: 'Linux 側',
  [TARGET.WINDOWS]: 'Windows 側',
};

const STORAGE_KEY = 'tana.wsl.defaultopen';

/** WSL 連携が使えないときの既定値（Rust から情報が来るまでの初期値にも使う） */
export const NO_WSL = { available: false, distro: '' };

/** Rust の wsl_info 応答を正規化する（不在・壊れた値は「使えない」に倒す） */
export function normalizeInfo(raw) {
  if (!raw || typeof raw !== 'object') return { ...NO_WSL };
  return {
    available: raw.available === true,
    distro: typeof raw.distro === 'string' ? raw.distro : '',
  };
}

/** 登録コマンドが Windows のプログラムに見えるか（target=auto の推定） */
export function looksLikeWindowsCommand(command) {
  const c = String(command || '').trim();
  if (!c) return false;
  if (/^[A-Za-z]:[\\/]/.test(c)) return true; // C:\… / C:/…
  return /\.(exe|bat|cmd|com)$/i.test(c);
}

/**
 * 外部アプリをどちら側で起動するか。
 * WSL 連携が使えない環境では常に LINUX（= その OS の通常経路）。
 * @param {{command?: string, target?: string}} app
 * @param {{available: boolean}} wsl
 */
export function resolveAppTarget(app, wsl) {
  if (!wsl || !wsl.available) return TARGET.LINUX;
  const t = app && app.target;
  if (t === TARGET.WINDOWS || t === TARGET.LINUX) return t;
  return looksLikeWindowsCommand(app && app.command) ? TARGET.WINDOWS : TARGET.LINUX;
}

/**
 * 既定オープン（アプリ指定なし）をどちら側へ流すか。
 * WSL では未設定・不正値を WINDOWS に倒す（上のコメントの理由）。
 * @param {string|null} pref 設定値
 * @param {{available: boolean}} wsl
 */
export function resolveDefaultTarget(pref, wsl) {
  if (!wsl || !wsl.available) return TARGET.LINUX;
  return pref === TARGET.LINUX ? TARGET.LINUX : TARGET.WINDOWS;
}

/**
 * メニュー項目のラベル。WSL では両方の項目が並ぶので、どちら側かを必ず明示する。
 * @param {'open'|'reveal'} kind
 * @param {string} target TARGET.LINUX / TARGET.WINDOWS
 * @param {boolean} wslAvailable
 */
export function openLabel(kind, target, wslAvailable) {
  if (kind === 'reveal') {
    if (target === TARGET.WINDOWS) return 'エクスプローラーで表示';
    return wslAvailable ? 'ファイルマネージャで表示（Linux）' : 'ファイルマネージャで表示';
  }
  if (target === TARGET.WINDOWS) return '既定のアプリで開く（Windows）';
  return wslAvailable ? '既定のアプリで開く（Linux）' : '外部アプリで開く';
}

/** localStorage から既定オープンの設定を読む（未設定・不正値は null） */
export function loadStoredDefaultOpen() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === TARGET.LINUX || v === TARGET.WINDOWS ? v : null;
  } catch {
    return null;
  }
}

/** 既定オープンの設定を保存する（不正値は保存しない） */
export function storeDefaultOpen(value) {
  if (value !== TARGET.LINUX && value !== TARGET.WINDOWS) return false;
  try {
    localStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    return false; // localStorage 不在時
  }
}
