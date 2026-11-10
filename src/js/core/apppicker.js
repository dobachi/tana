// apppicker.js — インストール済みアプリの一覧から外部アプリを選ぶ (FR-13)
//
// 外部アプリの登録は「コマンドのフルパスを手入力」だけだったため、Windows では
// `C:\Program Files\7-Zip\7zFM.exe` のようなパスを調べないと登録できなかった。
// 一覧は Rust の list_installed_apps（apps.rs）が作り、ここは絞り込みと選択 UI だけ。
//
// キーボードだけで完結する（NFR-U2）: 文字入力で絞り込み、↑↓ で移動、Enter で決定、Esc で閉じる。

import { TARGET } from './wsl.js';

/** 一度に描く件数の上限（一覧が数百件でも重くしない）。絞り込めば残りも出る。 */
export const MAX_ROWS = 200;

/**
 * 空白区切りの語をすべて含むものに絞る（表示名とコマンドの両方を見る。大文字小文字は無視）。
 * @param {Array<{name: string, command: string}>} apps
 * @param {string} query
 */
export function filterApps(apps, query) {
  const list = Array.isArray(apps) ? apps : [];
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return list.slice();
  return list.filter((a) => {
    const hay = `${a.name || ''} ${a.command || ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** 行の補足表示。WSL では Windows 側か Linux 側かを添える。 */
export function sideLabel(app, wslAvailable) {
  if (!wslAvailable) return '';
  if (app.target === TARGET.WINDOWS) return 'Windows';
  if (app.target === TARGET.LINUX) return 'Linux';
  return '';
}

/** 選択位置を範囲内に収める（一覧が空なら -1）。 */
export function clampIndex(i, length) {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, i));
}

/**
 * 選択モーダルを開く。選んだアプリ（{name, command, target}）か、閉じたら null を返す。
 * @param {{
 *   load: () => Promise<Array<{name: string, command: string, target?: string}>>,
 *   wsl?: boolean,
 *   doc?: Document,
 * }} opts
 * @returns {Promise<object|null>}
 */
export function showAppPicker(opts) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const wslAvailable = !!opts.wsl;
  return new Promise((resolve) => {
    if (!doc || !doc.body) {
      resolve(null);
      return;
    }
    const overlay = doc.createElement('div');
    overlay.className = 'modal-overlay app-picker-overlay';
    const box = doc.createElement('div');
    box.className = 'modal app-picker';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'インストール済みのアプリから選ぶ');

    const title = doc.createElement('div');
    title.className = 'modal-label';
    title.textContent = 'インストール済みのアプリから選ぶ';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'modal-input app-picker-filter';
    input.placeholder = '絞り込み（例: 7-zip）';
    input.setAttribute('aria-label', '絞り込み');

    const listEl = doc.createElement('div');
    listEl.className = 'app-picker-list';
    listEl.setAttribute('role', 'listbox');

    const status = doc.createElement('small');
    status.className = 'setting-hint app-picker-status';
    status.textContent = '一覧を読み込んでいます…';

    const row = doc.createElement('div');
    row.className = 'modal-buttons';
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'modal-btn';
    cancel.textContent = 'キャンセル (Esc)';
    cancel.addEventListener('click', () => finish(null));
    row.appendChild(cancel);

    box.append(title, input, listEl, status, row);
    overlay.appendChild(box);
    doc.body.appendChild(overlay);

    let all = [];
    let shown = [];
    let index = -1;
    let done = false;

    function finish(value) {
      if (done) return;
      done = true;
      overlay.remove();
      resolve(value);
    }

    function highlight() {
      const rows = listEl.querySelectorAll('.app-picker-row');
      rows.forEach((el, i) => {
        const on = i === index;
        el.classList.toggle('is-selected', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
      });
    }

    function render() {
      const matched = filterApps(all, input.value);
      shown = matched.slice(0, MAX_ROWS);
      listEl.textContent = '';
      shown.forEach((app, i) => {
        const el = doc.createElement('div');
        el.className = 'app-picker-row';
        el.setAttribute('role', 'option');
        const name = doc.createElement('span');
        name.className = 'app-picker-name';
        name.textContent = app.name;
        const cmd = doc.createElement('code');
        cmd.className = 'app-picker-command';
        cmd.textContent = app.command;
        el.append(name, cmd);
        const side = sideLabel(app, wslAvailable);
        if (side) {
          const tag = doc.createElement('span');
          tag.className = 'app-picker-side';
          tag.textContent = side;
          el.appendChild(tag);
        }
        el.addEventListener('click', () => finish(app));
        el.addEventListener('mousemove', () => {
          if (index !== i) {
            index = i;
            highlight();
          }
        });
        listEl.appendChild(el);
      });
      index = clampIndex(0, shown.length);
      highlight();
      if (!all.length) status.textContent = 'アプリが見つかりませんでした';
      else if (!matched.length) status.textContent = '一致するアプリがありません';
      else if (matched.length > shown.length)
        status.textContent = `${matched.length} 件中 ${shown.length} 件を表示（絞り込んでください）`;
      else status.textContent = `${matched.length} 件`;
    }

    input.addEventListener('input', render);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 設定画面ごと閉じないように
        finish(null);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        index = clampIndex(index + (e.key === 'ArrowDown' ? 1 : -1), shown.length);
        highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (index >= 0 && shown[index]) finish(shown[index]);
      }
    });
    // 背景クリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });

    input.focus();
    Promise.resolve()
      .then(() => opts.load())
      .then((apps) => {
        if (done) return;
        all = Array.isArray(apps) ? apps : [];
        render();
      })
      .catch((e) => {
        if (done) return;
        status.textContent =
          '一覧を取得できませんでした: ' + (e && e.message ? e.message : String(e));
      });
  });
}
