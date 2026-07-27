// workspacesview.js — ワークスペース（タブ構成の保存/復元）のオーバーレイ UI。
//
// 上部で「現在のタブ構成に名前を付けて保存」、下部で保存済みを一覧して開く/削除する。
// キーボード: 入力欄で Enter=保存 / ↓=一覧へ、一覧で j/k 移動・Enter で開く・
// Del or × で削除・Esc で閉じる。モデルは workspaces.js（純粋・テスト済み）。

/**
 * @param {object} deps
 * @param {object} deps.workspaces workspaces モデル
 * @param {() => {snapshot: object, suggestedName: string}} deps.getContext 現在のタブ構成と既定名
 * @param {(ws: object) => void} deps.onOpen 保存済みを開く（適用）
 * @param {Document} [deps.doc]
 */
export function createWorkspacesView(deps) {
  const {
    workspaces,
    getContext,
    onOpen,
    doc = typeof document !== 'undefined' ? document : null,
  } = deps;

  let overlay = null;
  let nameEl = null;
  let listEl = null;
  let rows = []; // { el, ws }
  let unsub = null;

  const isOpen = () => overlay !== null;

  function summary(ws) {
    const l = ws.left ? ws.left.length : 0;
    const r = ws.right ? ws.right.length : 0;
    return `左 ${l} / 右 ${r} タブ`;
  }

  function render() {
    if (!listEl) return;
    listEl.replaceChildren();
    rows = [];
    const items = workspaces.list();
    if (!items.length) {
      const li = doc.createElement('li');
      li.className = 'placeholder';
      li.textContent = '保存済みはありません';
      listEl.appendChild(li);
      return;
    }
    for (const ws of items) {
      const li = doc.createElement('li');
      li.className = 'ws-item';
      const row = doc.createElement('div');
      row.className = 'ws-row';
      row.tabIndex = -1;

      const name = doc.createElement('span');
      name.className = 'ws-name';
      name.textContent = ws.name;
      row.appendChild(name);

      const meta = doc.createElement('span');
      meta.className = 'ws-meta';
      meta.textContent = summary(ws);
      row.appendChild(meta);

      const del = doc.createElement('button');
      del.type = 'button';
      del.className = 'ws-remove';
      del.textContent = '×';
      del.title = '削除';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        workspaces.remove(ws.id);
      });
      row.appendChild(del);

      row.addEventListener('click', () => choose(ws));
      li.appendChild(row);
      rows.push({ el: row, ws });
      listEl.appendChild(li);
    }
  }

  function choose(ws) {
    close();
    if (onOpen) onOpen(ws);
  }

  function saveCurrent() {
    const ctx = getContext ? getContext() : null;
    const nm = (nameEl.value || '').trim();
    if (!ctx || !nm) return;
    workspaces.save(nm, ctx.snapshot);
    nameEl.value = '';
    render();
  }

  function setFocus(i) {
    if (!rows.length) return;
    rows[Math.max(0, Math.min(i, rows.length - 1))].el.focus();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const idx = rows.findIndex((r) => r.el === doc.activeElement);
    const inList = idx >= 0;
    if (e.target === nameEl) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveCurrent();
      } else if (e.key === 'ArrowDown' && rows.length) {
        e.preventDefault();
        setFocus(0);
      }
      return;
    }
    if (!inList) return;
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        setFocus(idx + 1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        if (idx <= 0) nameEl.focus();
        else setFocus(idx - 1);
        break;
      case 'Enter':
      case 'l':
        e.preventDefault();
        choose(rows[idx].ws);
        break;
      case 'Delete':
      case 'x':
        e.preventDefault();
        workspaces.remove(rows[idx].ws.id);
        break;
      default:
        break;
    }
  }

  function open() {
    if (!doc || !doc.body || overlay) return;
    overlay = doc.createElement('div');
    overlay.className = 'modal-overlay ws-overlay';
    const box = doc.createElement('div');
    box.className = 'modal ws-box';

    const title = doc.createElement('h2');
    title.className = 'ws-title';
    title.textContent = 'ワークスペース（タブ構成）';
    box.appendChild(title);

    const head = doc.createElement('div');
    head.className = 'ws-head';
    nameEl = doc.createElement('input');
    nameEl.type = 'text';
    nameEl.className = 'ws-input';
    nameEl.placeholder = '現在のタブ構成に名前を付けて保存…';
    nameEl.spellcheck = false;
    nameEl.autocomplete = 'off';
    const ctx = getContext ? getContext() : null;
    if (ctx && ctx.suggestedName) nameEl.value = ctx.suggestedName;
    head.appendChild(nameEl);
    const saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ws-save';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', saveCurrent);
    head.appendChild(saveBtn);
    box.appendChild(head);

    listEl = doc.createElement('ul');
    listEl.className = 'ws-list';
    box.appendChild(listEl);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', onKey);
    doc.body.appendChild(overlay);

    unsub = workspaces.subscribe(render);
    render();
    nameEl.focus();
    nameEl.select();
  }

  function close() {
    if (!overlay) return;
    if (unsub) {
      unsub();
      unsub = null;
    }
    overlay.remove();
    overlay = null;
    nameEl = listEl = null;
    rows = [];
  }

  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
}
