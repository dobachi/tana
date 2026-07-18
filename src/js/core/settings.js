// settings.js — 設定画面（Fude と同じ overlay/panel 構成の操作感）
//
// Fude の設定は「編集して Save」だが、Tana の設定はすべて即時反映・即時永続化
// （localStorage）なので Save ボタンは置かない。フッタは閉じるだけ。
// 値の真実源は各モジュール（theme.js / fontscale.js）側にあり、ここは UI だけ。

import { THEMES, THEME_LABELS } from './theme.js';
import { MIN_SCALE, MAX_SCALE, STEP, toPercent } from './fontscale.js';

let panelEl = null;

/** 設定画面が開いているか */
export function isSettingsOpen() {
  return !!panelEl;
}

export function closeSettings() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
}

/**
 * 設定画面を開く。すでに開いていれば何もしない。
 * @param {{
 *   theme: {get: () => string, set: (t: string) => string},
 *   fontScale: {get: () => number, set: (v: number) => number},
 *   getShowHidden: () => boolean,
 *   setShowHidden: (v: boolean) => void,
 * }} deps
 */
export function openSettings(deps) {
  if (panelEl) return panelEl;
  const { theme, fontScale, getShowHidden, setShowHidden } = deps;

  panelEl = document.createElement('div');
  panelEl.className = 'settings-overlay';
  panelEl.innerHTML = `
    <div class="settings-panel" role="dialog" aria-modal="true" aria-label="設定">
      <div class="settings-header">
        <span>設定</span>
        <button class="settings-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="settings-body">
        <div class="setting-group">
          <label for="setting-theme">テーマ</label>
          <select id="setting-theme">
            ${THEMES.map(
              (t) =>
                `<option value="${t}"${t === theme.get() ? ' selected' : ''}>${THEME_LABELS[t]}</option>`,
            ).join('')}
          </select>
        </div>
        <div class="setting-group">
          <label for="setting-fontscale">
            文字サイズ: <span id="setting-fontscale-value">${toPercent(fontScale.get())}%</span>
          </label>
          <input type="range" id="setting-fontscale"
            min="${toPercent(MIN_SCALE)}" max="${toPercent(MAX_SCALE)}"
            step="${toPercent(STEP)}" value="${toPercent(fontScale.get())}" />
          <small class="setting-hint">Ctrl + + / - / 0 でも変更できます。</small>
        </div>
        <div class="setting-group">
          <label>
            <input type="checkbox" id="setting-show-hidden"${getShowHidden() ? ' checked' : ''} />
            隠しファイルを表示
          </label>
          <small class="setting-hint">Ctrl + H でも切り替えられます。</small>
        </div>
      </div>
      <div class="settings-footer">
        <small class="setting-hint">変更は即座に反映・保存されます。</small>
        <button class="modal-btn primary btn-close-settings" type="button">閉じる</button>
      </div>
    </div>`;

  document.body.appendChild(panelEl);

  panelEl.querySelector('.settings-close').addEventListener('click', closeSettings);
  panelEl.querySelector('.btn-close-settings').addEventListener('click', closeSettings);
  // 背景クリックで閉じる（パネル内クリックでは閉じない）
  panelEl.addEventListener('click', (e) => {
    if (e.target === panelEl) closeSettings();
  });
  panelEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeSettings();
    }
  });

  panelEl.querySelector('#setting-theme').addEventListener('change', (e) => {
    theme.set(e.target.value);
  });

  const slider = panelEl.querySelector('#setting-fontscale');
  const sliderValue = panelEl.querySelector('#setting-fontscale-value');
  slider.addEventListener('input', (e) => {
    const applied = fontScale.set(parseInt(e.target.value, 10) / 100);
    // クランプされた場合はスライダー側も実値に合わせる
    sliderValue.textContent = `${toPercent(applied)}%`;
    e.target.value = String(toPercent(applied));
  });

  panelEl.querySelector('#setting-show-hidden').addEventListener('change', (e) => {
    setShowHidden(e.target.checked);
  });

  panelEl.querySelector('.settings-close').focus();
  return panelEl;
}
