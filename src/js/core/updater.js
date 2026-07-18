// updater.js — 起動時の更新検知と手動チェック（Tauri updater プラグイン）
//
// 更新の有無は GitHub Releases の latest.json を見て判定する。ブラウザ単体や
// テスト環境では Tauri が居ないので、プラグインは動的 import して触らない。
import { isDesktop } from '../backend.js';

/**
 * 手動チェックの結果メッセージを決める純粋関数。
 * Tauri ランタイム無しでテストできるよう、判定だけを切り出してある。
 * 優先順: 非デスクトップ > エラー > 更新あり > 最新
 * @param {{isDesktop: boolean, update: object|null, error: string|null}} state
 * @returns {{kind: string, type?: string, message?: string, version?: string}}
 */
export function describeManualCheck({ isDesktop: desktop, update, error }) {
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
  return { kind: 'latest', type: 'info', message: '最新版を使用しています。' };
}

/**
 * 更新を確認し、あればダイアログを出す。
 * @param {{manual?: boolean, notify?: (message: string) => void}} [opts]
 *   manual=false（起動時）はエラーを黙って握りつぶす。ネットワーク不通や
 *   リリース未公開のたびにトーストが出ると邪魔になるため。
 */
export async function checkForUpdates(opts = {}) {
  const { manual = false, notify } = opts;

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
    showUpdateDialog(update);
    return;
  }
  if (!manual) {
    if (error) console.info('更新チェックをスキップ:', error);
    return;
  }
  const r = describeManualCheck({ isDesktop: true, update: null, error });
  notify?.(r.message);
}

/** 更新の案内ダイアログ。アプリ既存の .modal-overlay / .modal 規約に合わせる。 */
function showUpdateDialog(update) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="アップデート">
      <p class="modal-msg">Tana ${update.version} が利用可能です</p>
      <p class="modal-label">${update.body || ''}</p>
      <div class="modal-buttons">
        <button class="modal-btn btn-skip">スキップ</button>
        <button class="modal-btn primary btn-update">アップデート</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const skipBtn = overlay.querySelector('.btn-skip');
  const updateBtn = overlay.querySelector('.btn-update');
  skipBtn.addEventListener('click', () => overlay.remove());
  updateBtn.addEventListener('click', async () => {
    updateBtn.textContent = 'ダウンロード中...';
    updateBtn.disabled = true;
    skipBtn.disabled = true;
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      console.error('アップデートに失敗:', e);
      overlay.remove();
    }
  });
  updateBtn.focus();
}
