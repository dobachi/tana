// workspacesview.js — ワークスペースのオーバーレイ UI（ファイル → ワークスペース…）。
//
// 一覧から選んで切り替える。新規・名前の変更・削除と、選んだワークスペースで
// 「保存する項目」を選ぶ。モデルは workspaces.js（純粋・テスト済み）。
// キーボード: j/k・↑↓ で移動、Enter/l で切り替え、n 新規、r 名前を変更、
// Del/x 削除、Esc で閉じる。

import { createModalHeader } from './modalheader.js';
import { KEEP_ITEMS } from './workspaces.js';

/**
 * @param {object} deps
 * @param {object} deps.workspaces workspaces モデル
 * @param {(name: string) => void} deps.onSwitch 切り替える（適用は呼び出し側）
 * @param {(title: string, value?: string) => Promise<string|null>} deps.ask 名前の入力
 * @param {() => boolean} [deps.isMain] 最初のウィンドウか（他では「このウィンドウで開く」）
 * @param {(msg: string) => void} [deps.notify] エラーの知らせ
 * @param {Document} [deps.doc]
 */
export function createWorkspacesView(deps) {
  const {
    workspaces,
    onSwitch,
    ask,
    isMain = () => true,
    notify = () => {},
    doc = typeof document !== 'undefined' ? document : null,
  } = deps;

  let overlay = null;
  let listEl = null;
  let keepEl = null;
  let switchBtn = null;
  let removeBtn = null;
  let rows = []; // { el, name }
  let selected = null;
  let busy = false; // 名前の入力中（キーはそちらのもの）
  let unsub = null;

  const isOpen = () => overlay !== null;

  function summary(ws) {
    const s = ws.session;
    if (!s) return 'まだ何も保存されていません';
    const count = (p) => (s.tabs[p] ? s.tabs[p].length : s.dirs[p] ? 1 : 0);
    return `左 ${count('left')} / 右 ${count('right')} タブ`;
  }

  function render() {
    if (!listEl) return;
    const items = workspaces.list();
    if (!items.some((w) => w.name === selected)) selected = workspaces.active();
    const focused = rows.some((r) => r.el === doc.activeElement);
    listEl.replaceChildren();
    rows = [];
    for (const ws of items) {
      const li = doc.createElement('li');
      li.className = 'ws-item';
      const row = doc.createElement('div');
      row.className = 'ws-row' + (ws.name === selected ? ' selected' : '');
      row.tabIndex = -1;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(ws.name === selected));

      const name = doc.createElement('span');
      name.className = 'ws-name';
      name.textContent = ws.name;
      row.appendChild(name);

      if (ws.active) {
        const tag = doc.createElement('span');
        tag.className = 'ws-active-tag';
        tag.textContent = '使用中';
        row.appendChild(tag);
      }

      const meta = doc.createElement('span');
      meta.className = 'ws-meta';
      meta.textContent = summary(ws);
      row.appendChild(meta);

      row.addEventListener('click', () => select(ws.name));
      row.addEventListener('dblclick', () => choose(ws.name));
      li.appendChild(row);
      rows.push({ el: row, name: ws.name });
      listEl.appendChild(li);
    }
    renderKeep();
    if (focused) focusSelected();
  }

  function renderKeep() {
    const ws = workspaces.get(selected);
    if (!ws || !keepEl) return;
    keepEl.querySelector('.ws-keep-title').textContent = `「${ws.name}」で保存する項目`;
    for (const box of keepEl.querySelectorAll('[data-keep]')) {
      box.checked = ws.keep[box.dataset.keep] !== false;
      // タブは場所の一覧なので、場所を保存しないなら選べない
      if (box.dataset.keep === 'tabs') box.disabled = ws.keep.dirs === false;
    }
    const isActive = ws.name === workspaces.active();
    const main = isMain();
    removeBtn.disabled = isActive || workspaces.list().length <= 1;
    removeBtn.title = isActive ? '使用中のワークスペースは、切り替えてから削除してください' : '';
    switchBtn.disabled = main && isActive;
    switchBtn.textContent = !main ? 'このウィンドウで開く' : isActive ? '使用中' : '切り替え';
  }

  function select(name) {
    selected = name;
    render();
    focusSelected();
  }

  function focusSelected() {
    const r = rows.find((x) => x.name === selected);
    if (r) r.el.focus();
  }

  function move(step) {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.name === selected);
    const next = Math.max(0, Math.min(rows.length - 1, i + step));
    select(rows[next].name);
  }

  function choose(name) {
    if (isMain() && name === workspaces.active()) return;
    close();
    if (onSwitch) onSwitch(name);
  }

  async function askName(title, value, except = null) {
    busy = true;
    try {
      for (;;) {
        const name = await ask(title, value);
        if (name === null || name === undefined) return null;
        const err = workspaces.nameError(name, except);
        if (!err) return name.trim();
        title = `${err}。別の名前を入力してください`;
        value = name;
      }
    } finally {
      busy = false;
      if (overlay) focusSelected();
    }
  }

  async function addNew() {
    const name = await askName('新しいワークスペースの名前', '');
    if (!name || !overlay) return;
    workspaces.add(name);
    select(name);
  }

  async function renameSelected() {
    const from = selected;
    const name = await askName('新しい名前', from, from);
    if (!name || name === from || !overlay) return;
    workspaces.rename(from, name);
    select(name);
  }

  function removeSelected() {
    try {
      workspaces.remove(selected);
    } catch (e) {
      notify(e.message);
    }
  }

  function onKey(e) {
    if (busy) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // チェックボックスやボタンの上ではそれぞれの既定動作に任せる
    if (!rows.some((r) => r.el === doc.activeElement)) return;
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
      case 'l':
        e.preventDefault();
        choose(selected);
        break;
      case 'n':
        e.preventDefault();
        addNew();
        break;
      case 'r':
        e.preventDefault();
        renameSelected();
        break;
      case 'Delete':
      case 'x':
        e.preventDefault();
        removeSelected();
        break;
      default:
        break;
    }
  }

  function button(cls, label, onClick) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function open() {
    if (!doc || !doc.body || overlay) return;
    selected = workspaces.active();
    overlay = doc.createElement('div');
    overlay.className = 'modal-overlay ws-overlay';
    const box = doc.createElement('div');
    box.className = 'modal ws-box';

    box.appendChild(
      createModalHeader(doc, { title: 'ワークスペース', titleClass: 'ws-title', onClose: close }),
    );

    listEl = doc.createElement('ul');
    listEl.className = 'ws-list';
    listEl.setAttribute('role', 'listbox');
    box.appendChild(listEl);

    const actions = doc.createElement('div');
    actions.className = 'ws-actions';
    removeBtn = button('ws-btn ws-remove', '削除 (x)', removeSelected);
    actions.append(
      button('ws-btn ws-add', '新規… (n)', addNew),
      button('ws-btn ws-rename', '名前を変更… (r)', renameSelected),
      removeBtn,
    );
    box.appendChild(actions);

    keepEl = doc.createElement('div');
    keepEl.className = 'ws-keep';
    const title = doc.createElement('div');
    title.className = 'ws-keep-title';
    keepEl.appendChild(title);
    for (const { key, label } of KEEP_ITEMS) {
      const l = doc.createElement('label');
      const box2 = doc.createElement('input');
      box2.type = 'checkbox';
      box2.dataset.keep = key;
      box2.addEventListener('change', () => {
        const ws = workspaces.get(selected);
        if (ws) workspaces.setKeep(selected, { ...ws.keep, [key]: box2.checked });
      });
      l.append(box2, doc.createTextNode(` ${label}`));
      keepEl.appendChild(l);
    }
    const hint = doc.createElement('small');
    hint.className = 'ws-hint';
    hint.textContent = 'チェックを外した項目は、このワークスペースでは保存も復元もされません。';
    keepEl.appendChild(hint);
    box.appendChild(keepEl);

    const foot = doc.createElement('div');
    foot.className = 'modal-buttons';
    switchBtn = button('modal-btn primary ws-switch', '切り替え', () => choose(selected));
    foot.append(switchBtn, button('modal-btn ws-done', '閉じる (Esc)', close));
    box.appendChild(foot);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !busy) close();
    });
    overlay.addEventListener('keydown', onKey);
    doc.body.appendChild(overlay);

    unsub = workspaces.subscribe(render);
    render();
    focusSelected();
  }

  function close() {
    if (!overlay) return;
    if (unsub) unsub();
    unsub = null;
    overlay.remove();
    overlay = null;
    listEl = null;
    keepEl = null;
    rows = [];
  }

  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
}
