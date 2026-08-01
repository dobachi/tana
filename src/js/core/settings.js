// settings.js — 設定画面（Fude と同じ overlay/panel 構成の操作感）
//
// Fude の設定は「編集して Save」だが、Tana の設定はすべて即時反映・即時永続化
// （localStorage）なので Save ボタンは置かない。フッタは閉じるだけ。
// 値の真実源は各モジュール（theme.js / fontscale.js）側にあり、ここは UI だけ。

import { THEMES, THEME_LABELS } from './theme.js';
import { MIN_SCALE, MAX_SCALE, STEP, toPercent } from './fontscale.js';
import { QUICK_SLOTS } from './extapps.js';

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
 *   extApps?: {list: () => Array, add: (a: object) => object, remove: (id: string) => boolean,
 *              move: (id: string, dir: number) => boolean},
 * }} deps
 */
export function openSettings(deps) {
  if (panelEl) return panelEl;
  const { theme, fontScale, getShowHidden, setShowHidden, extApps } = deps;

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
        <div class="setting-group" id="setting-extapps-group">
          <label>外部アプリ（別のアプリで開く）</label>
          <div id="setting-extapps-list"></div>
          <div class="extapp-add">
            <input type="text" id="setting-extapp-name" placeholder="表示名（省略可）" />
            <input type="text" id="setting-extapp-command" placeholder="コマンド / アプリ名" />
            <button type="button" class="modal-btn" id="setting-extapp-add">追加</button>
          </div>
          <small class="setting-hint" id="setting-extapp-msg">
            上から ${QUICK_SLOTS} 件が <code>o → 1</code>…<code>o → ${QUICK_SLOTS}</code> に割り当たります。
            右クリック →「別のアプリで開く…」からも選べます。
            コマンドは Windows/Linux は実行ファイル名かフルパス、macOS はアプリ名（例: Visual Studio Code）。
            引数は渡せません。
          </small>
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

  setupExtApps(panelEl, extApps);

  panelEl.querySelector('.settings-close').focus();
  return panelEl;
}

/**
 * 「外部アプリ」セクションの描画とイベント（FR-13）。
 * extApps を渡さない呼び出し（テスト等）ではセクションごと隠す。
 */
function setupExtApps(root, extApps) {
  const group = root.querySelector('#setting-extapps-group');
  if (!group) return;
  if (!extApps) {
    group.style.display = 'none';
    return;
  }
  const listEl = root.querySelector('#setting-extapps-list');
  const nameEl = root.querySelector('#setting-extapp-name');
  const cmdEl = root.querySelector('#setting-extapp-command');
  const addBtn = root.querySelector('#setting-extapp-add');
  const msgEl = root.querySelector('#setting-extapp-msg');
  const defaultMsg = msgEl ? msgEl.innerHTML : '';

  function notify(text) {
    if (!msgEl) return;
    if (text) msgEl.textContent = text;
    else msgEl.innerHTML = defaultMsg;
  }

  function render() {
    const apps = extApps.list();
    listEl.textContent = '';
    if (!apps.length) {
      const empty = document.createElement('small');
      empty.className = 'setting-hint';
      empty.textContent = 'まだ登録がありません。';
      listEl.appendChild(empty);
      return;
    }
    apps.forEach((app, i) => {
      const row = document.createElement('div');
      row.className = 'extapp-row';

      const slot = document.createElement('span');
      slot.className = 'extapp-slot';
      // 10件目以降は二打鍵の割り当てが無いので番号を出さない（嘘の案内をしない）
      slot.textContent = i < QUICK_SLOTS ? String(i + 1) : '–';

      const name = document.createElement('span');
      name.className = 'extapp-name';
      name.textContent = app.name;

      const cmd = document.createElement('code');
      cmd.className = 'extapp-command';
      cmd.textContent = app.command;

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'modal-btn';
      up.textContent = '↑';
      up.title = '上へ（番号が若くなる）';
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        extApps.move(app.id, -1);
        render();
      });

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'modal-btn';
      down.textContent = '↓';
      down.title = '下へ';
      down.disabled = i === apps.length - 1;
      down.addEventListener('click', () => {
        extApps.move(app.id, 1);
        render();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'modal-btn';
      del.textContent = '削除';
      del.addEventListener('click', () => {
        extApps.remove(app.id);
        notify('');
        render();
      });

      row.append(slot, name, cmd, up, down, del);
      listEl.appendChild(row);
    });
  }

  function add() {
    const res = extApps.add({ name: nameEl.value, command: cmdEl.value });
    if (!res.ok) {
      notify(res.reason);
      cmdEl.focus();
      return;
    }
    nameEl.value = '';
    cmdEl.value = '';
    notify('');
    render();
    nameEl.focus();
  }

  addBtn.addEventListener('click', add);
  // Enter で追加できるように（設定画面は Esc で閉じるので Enter は衝突しない）
  for (const el of [nameEl, cmdEl]) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
  }

  render();
}
