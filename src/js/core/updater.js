// updater.js — 起動時の更新検知と手動チェック（Tauri updater プラグイン）
//
// 更新の有無は GitHub Releases の latest.json を見て判定する。ブラウザ単体や
// テスト環境では Tauri が居ないので、プラグインは動的 import して触らない。
import { isDesktop, updateEnv } from '../backend.js';

/** 手動更新の誘導先（リリース一覧）。 */
const RELEASE_PAGE = 'https://github.com/dobachi/tana/releases/latest';

/**
 * 手動チェックの結果メッセージを決める純粋関数。
 * Tauri ランタイム無しでテストできるよう、判定だけを切り出してある。
 * 優先順: 非デスクトップ > エラー > 更新あり > 最新
 * @param {{isDesktop: boolean, update: object|null, error: string|null}} state
 * @returns {{kind: string, type?: string, message?: string, version?: string}}
 */
export function describeManualCheck({ isDesktop: desktop, update, error, currentVersion }) {
  if (!desktop) {
    return {
      kind: 'unsupported',
      type: 'error',
      message: 'アップデートの確認はデスクトップ版でのみ利用できます。',
    };
  }
  if (error) {
    return { kind: 'error', type: 'error', message: `アップデートの確認に失敗しました: ${error}` };
  }
  if (update) {
    return { kind: 'update', version: update.version };
  }
  const ver = currentVersion ? ` (v${currentVersion})` : '';
  return { kind: 'latest', type: 'info', message: `最新版を使用しています${ver}。` };
}

/**
 * 更新の適用方法を決める純粋関数（DOM にも Tauri にも依存しない）。
 *
 * WSL の deb/rpm 版ではアプリ内更新が構造的に完了しない。updater プラグインは
 * `pkexec`（エージェント不在のためコンソールで質問して失敗）→ zenity（GUI でもう一度
 * 質問）→ 端末 `sudo` の順に権限昇格を試すので、パスワードを 2 度聞かれた末に必ず
 * 失敗する。可否は update_env コマンドで先に分かるので、その場合は最初から
 * 「リリースページを開く」に切り替えて、無駄な認証要求を起こさない。
 *
 * @param {{can_install?: boolean}|null} [env] update_env の結果（Tauri 不在なら null）
 * @returns {{mode: 'in-app'|'manual', label: string, note: string}}
 */
export function describeInstallPlan(env = null) {
  if (env && env.can_install === false) {
    return {
      mode: 'manual',
      label: 'リリースページを開く',
      note: 'この形式（deb / rpm）の更新には管理者権限が必要ですが、この環境（WSL など）では認証できないため、アプリ内では更新を完了できません。リリースページからパッケージを取得して更新してください。',
    };
  }
  return { mode: 'in-app', label: 'アップデート', note: '' };
}

/**
 * インストール失敗時の文言を組み立てる純粋関数。
 * 以前は失敗しても黙ってダイアログが閉じるだけで、理由が利用者に届かなかった。
 * @param {unknown} error
 * @param {{isLinux?: boolean}} [opts]
 * @returns {{detail: string, hint: string}}
 */
export function describeInstallError(error, opts = {}) {
  const { isLinux = false } = opts;
  const detail = error && error.message ? error.message : String(error ?? '不明なエラー');
  const hint = isLinux
    ? 'Linux の deb / rpm 版は、インストールに管理者権限（PolicyKit）が必要です。認証できない環境ではアプリ内で更新を完了できません。リリースページから手動で更新してください。'
    : '時間をおいて再試行するか、リリースページから手動で更新してください。';
  return { detail, hint };
}

/** Linux かどうか（失敗時の案内を出し分けるだけの用途）。 */
export function isLinuxPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const s = `${nav?.platform || ''} ${nav?.userAgent || ''}`;
  return /linux/i.test(s) && !/android/i.test(s);
}

/**
 * 更新を確認し、あればダイアログを出す。
 * @param {{manual?: boolean, notify?: (message: string) => void}} [opts]
 *   manual=false（起動時）はエラーを黙って握りつぶす。ネットワーク不通や
 *   リリース未公開のたびにトーストが出ると邪魔になるため。
 */
export async function checkForUpdates(opts = {}) {
  const { manual = false, notify, currentVersion = '' } = opts;

  if (!isDesktop()) {
    if (manual) {
      const r = describeManualCheck({ isDesktop: false, update: null, error: null });
      notify?.(r.message);
    }
    return;
  }

  let update = null;
  let error = null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    update = await check();
  } catch (e) {
    error = e?.message || String(e);
  }

  if (update) {
    await showUpdateDialog(update);
    return;
  }
  if (!manual) {
    if (error) console.info('更新チェックをスキップ:', error);
    return;
  }
  const r = describeManualCheck({ isDesktop: true, update: null, error, currentVersion });
  notify?.(r.message);
}

/** 更新の案内ダイアログ。アプリ既存の .modal-overlay / .modal 規約に合わせる。 */
async function showUpdateDialog(update) {
  let env = null;
  try {
    env = await updateEnv();
  } catch (e) {
    console.info('更新環境の判定に失敗:', e); // 判定できなければ従来どおり試す
  }
  const plan = describeInstallPlan(env);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="アップデート">
      <p class="modal-msg">Tana ${escapeText(update.version)} が利用可能です</p>
      <p class="modal-label">${escapeText(update.body || '')}</p>
      ${plan.note ? `<p class="modal-label update-note">${escapeText(plan.note)}</p>` : ''}
      <div class="modal-buttons">
        <button class="modal-btn btn-skip">スキップ</button>
        <button class="modal-btn primary btn-update">${escapeText(plan.label)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const skipBtn = overlay.querySelector('.btn-skip');
  const updateBtn = overlay.querySelector('.btn-update');
  skipBtn.addEventListener('click', () => overlay.remove());
  updateBtn.addEventListener('click', async () => {
    if (plan.mode === 'manual') {
      await openReleasePage();
      overlay.remove();
      return;
    }
    updateBtn.textContent = 'ダウンロード中...';
    updateBtn.disabled = true;
    skipBtn.disabled = true;
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      console.error('アップデートに失敗:', e);
      showInstallError(overlay, e);
    }
  });
  updateBtn.focus();
}

/** リリース一覧をブラウザで開く。 */
async function openReleasePage() {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(RELEASE_PAGE);
  } catch (e) {
    console.error('リリースページを開けませんでした:', e);
  }
}

/**
 * 失敗の理由をダイアログに出す。黙って閉じると利用者には何も伝わらないため、
 * 閉じずに理由と対処を差し替える。
 */
function showInstallError(overlay, error) {
  const { detail, hint } = describeInstallError(error, { isLinux: isLinuxPlatform() });
  const modal = overlay.querySelector('.modal');
  if (!modal) {
    overlay.remove();
    return;
  }
  modal.innerHTML = `
    <p class="modal-msg">アップデートに失敗しました</p>
    <p class="modal-label update-error-detail">${escapeText(detail)}</p>
    <p class="modal-label update-error-hint">${escapeText(hint)}</p>
    <div class="modal-buttons">
      <button class="modal-btn btn-close">閉じる</button>
      <button class="modal-btn primary btn-release">リリースページを開く</button>
    </div>`;
  modal.querySelector('.btn-close').addEventListener('click', () => overlay.remove());
  modal.querySelector('.btn-release').addEventListener('click', async () => {
    await openReleasePage();
    overlay.remove();
  });
  modal.querySelector('.btn-release').focus();
}

/** innerHTML に入れる文字列のエスケープ（エラーやリリースノートは任意の文字列）。 */
function escapeText(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
