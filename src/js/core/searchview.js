// searchview.js — 現在ディレクトリ内検索のオーバーレイ (FR-18)
//
// 入力に応じて backend.searchDir を呼び、名前一致/内容一致の結果を一覧表示する。
// キーボード: 入力で ↓ → 結果へ、結果で j/k 移動・Enter でジャンプ・Esc で閉じる。
// 実際のマッチングは Rust 側（純粋部分はテスト済み）。ここは UI と結線のみ。

/**
 * @param {object} deps
 * @param {(dir:string, query:string, opts:object)=>Promise<Array>} deps.searchDir
 * @param {() => string|null} deps.getDir 検索の起点（アクティブペインの現在地）
 * @param {(hit:object)=>void} deps.onOpen ヒットを開く（親へ移動+カーソル等）
 * @param {Document} [deps.doc]
 * @param {number} [deps.debounceMs]
 */
export function createSearch(deps) {
  const {
    searchDir,
    getDir,
    onOpen,
    doc = typeof document !== 'undefined' ? document : null,
    debounceMs = 250,
  } = deps;

  let overlay = null;
  let inputEl = null;
  let statusEl = null;
  let listEl = null;
  let hiddenChk = null;
  let caseChk = null;
  let regexChk = null;
  let contentChk = null;
  let rows = []; // { el, hit }
  let gen = 0;
  let timer = null;

  function isOpen() {
    return overlay !== null;
  }

  function relPath(root, path) {
    if (root && path.startsWith(root)) {
      const r = path.slice(root.length).replace(/^\/+/, '');
      return r || path;
    }
    return path;
  }

  function render(root, hits) {
    listEl.replaceChildren();
    rows = [];
    if (!hits.length) {
      const li = doc.createElement('li');
      li.className = 'placeholder';
      li.textContent = '一致なし';
      listEl.appendChild(li);
      return;
    }
    for (const hit of hits) {
      const li = doc.createElement('li');
      li.className = 'search-hit';
      const row = doc.createElement('div');
      row.className = 'search-row';
      row.tabIndex = -1;

      const kind = doc.createElement('span');
      kind.className = 'search-kind';
      kind.textContent = hit.kind === 'content' ? '本文' : '名前';
      row.appendChild(kind);

      const main = doc.createElement('span');
      main.className = 'search-main';
      const loc = hit.line_no
        ? `${relPath(root, hit.path)}:${hit.line_no}`
        : relPath(root, hit.path);
      main.textContent = hit.kind === 'content' ? `${loc}  ${hit.line || ''}` : loc;
      row.appendChild(main);

      row.title = hit.path;
      row.addEventListener('click', () => choose(hit));
      li.appendChild(row);
      rows.push({ el: row, hit });
      listEl.appendChild(li);
    }
  }

  function choose(hit) {
    close();
    if (onOpen) onOpen(hit);
  }

  function setFocus(i) {
    if (!rows.length) return;
    const idx = Math.max(0, Math.min(i, rows.length - 1));
    rows[idx].el.focus();
  }

  async function run() {
    const dir = getDir && getDir();
    const query = inputEl.value.trim();
    if (!dir || !query) {
      if (listEl) render(dir, []);
      statusEl.textContent = dir ? '' : '検索するディレクトリがありません';
      return;
    }
    const my = ++gen;
    statusEl.textContent = '検索中…';
    let hits;
    try {
      hits = await searchDir(dir, query, {
        includeHidden: !!(hiddenChk && hiddenChk.checked),
        caseInsensitive: !(caseChk && caseChk.checked),
        regex: !!(regexChk && regexChk.checked),
        searchContent: !!(contentChk && contentChk.checked),
      });
    } catch {
      hits = [];
    }
    if (my !== gen || !overlay) return; // 追い越された/閉じられた
    render(dir, hits);
    statusEl.textContent = `${hits.length} 件${hits.length >= 500 ? '（上限）' : ''}`;
  }

  function scheduleRun() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const inList = rows.some((r) => r.el === doc.activeElement);
    // 入力欄から下キーで結果へ
    if (!inList && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      if (rows.length) {
        e.preventDefault();
        setFocus(0);
      }
      return;
    }
    if (!inList) return;
    const idx = rows.findIndex((r) => r.el === doc.activeElement);
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        setFocus(idx + 1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        if (idx <= 0) inputEl.focus();
        else setFocus(idx - 1);
        break;
      case 'Enter':
      case 'l':
        e.preventDefault();
        choose(rows[idx].hit);
        break;
      default:
        break;
    }
  }

  function open() {
    if (!doc || !doc.body || overlay) return;
    overlay = doc.createElement('div');
    overlay.className = 'modal-overlay search-overlay';

    const box = doc.createElement('div');
    box.className = 'modal search-box';

    const head = doc.createElement('div');
    head.className = 'search-head';
    inputEl = doc.createElement('input');
    inputEl.type = 'search';
    inputEl.className = 'search-input';
    inputEl.placeholder = '現在ディレクトリ内を名前で検索（本文も検索は「本文」をON）…';
    inputEl.spellcheck = false;
    inputEl.autocomplete = 'off';
    head.appendChild(inputEl);

    // オプション（チェックボックス）。作りつつ再検索の結線もする。
    const mkOpt = (label, title) => {
      const l = doc.createElement('label');
      l.className = 'search-opt';
      if (title) l.title = title;
      const chk = doc.createElement('input');
      chk.type = 'checkbox';
      chk.addEventListener('change', run);
      l.appendChild(chk);
      l.appendChild(doc.createTextNode(label));
      head.appendChild(l);
      return chk;
    };
    contentChk = mkOpt('本文', 'ファイル本文も検索する（重い。既定は名前のみで高速）');
    caseChk = mkOpt('Aa', '大文字小文字を区別');
    regexChk = mkOpt('.*', '正規表現で検索');
    hiddenChk = mkOpt('隠し', '隠しファイルも対象にする');
    box.appendChild(head);

    statusEl = doc.createElement('div');
    statusEl.className = 'search-status';
    box.appendChild(statusEl);

    listEl = doc.createElement('ul');
    listEl.className = 'search-list';
    box.appendChild(listEl);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', onKey);
    inputEl.addEventListener('input', scheduleRun);

    doc.body.appendChild(overlay);
    inputEl.focus();
  }

  function close() {
    if (!overlay) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    gen += 1;
    overlay.remove();
    overlay = null;
    inputEl = statusEl = listEl = hiddenChk = caseChk = regexChk = contentChk = null;
    rows = [];
  }

  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
}
