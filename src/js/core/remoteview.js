// remoteview.js — リモート接続のオーバーレイ UI (FR-20)。
//
// 上段: 接続先（最近/接続中/~/.ssh/config から候補）とパスを入れて「開く」。
//        「書き込みを許可する」は既定オフ（閲覧のみ）。
// 下段: 接続中の一覧。接続ごとに書き込み許可の切替・開く・切断。
// キーボード: 入力欄で Enter=開く、Esc=閉じる。候補・パスの組み立ては remotes.js（純粋）。

import { hostCandidates, targetUri } from './remotes.js';
import { createModalHeader } from './modalheader.js';

const SOURCE_LABEL = { recent: '最近', connected: '接続中', config: 'ssh config' };

/**
 * @param {object} deps
 * @param {ReturnType<import('./remotes.js').createRemotes>} deps.remotes
 * @param {() => Promise<string[]>} deps.getConfiguredHosts ~/.ssh/config の Host 名
 * @param {() => Promise<Array<{host: string, writable: boolean, home?: string}>>} deps.getSessions
 * @param {(uri: string, opts: {host: string, writable: boolean}) => Promise<void>} deps.onOpen
 *   開く。失敗は throw（文言は画面に出す）
 * @param {(host: string) => Promise<void>|void} deps.onDisconnect
 * @param {(host: string, on: boolean) => Promise<void>|void} deps.onSetWritable
 * @param {Document} [deps.doc]
 */
export function createRemoteView(deps) {
  const {
    remotes,
    getConfiguredHosts,
    getSessions,
    onOpen,
    onDisconnect,
    onSetWritable,
    doc = typeof document !== 'undefined' ? document : null,
  } = deps;

  let overlay = null;
  let hostEl = null;
  let pathEl = null;
  let writeEl = null;
  let openBtn = null;
  let msgEl = null;
  let listEl = null;
  let datalistEl = null;
  let busy = false;
  let configured = [];
  let sessions = [];

  const isOpen = () => overlay !== null;

  function setMessage(text, isError = false) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.classList.toggle('error', !!isError);
  }

  function renderCandidates() {
    if (!datalistEl) return;
    datalistEl.replaceChildren();
    const cands = hostCandidates({
      recent: remotes.recent(),
      connected: sessions.map((s) => s.host),
      configured,
    });
    for (const c of cands) {
      const opt = doc.createElement('option');
      opt.value = c.host;
      opt.label = SOURCE_LABEL[c.source] || '';
      datalistEl.appendChild(opt);
    }
  }

  function renderSessions() {
    if (!listEl) return;
    listEl.replaceChildren();
    if (!sessions.length) {
      const li = doc.createElement('li');
      li.className = 'placeholder';
      li.textContent = '接続はありません';
      listEl.appendChild(li);
      return;
    }
    for (const s of sessions) {
      const li = doc.createElement('li');
      li.className = 'remote-session';

      const name = doc.createElement('span');
      name.className = 'remote-host';
      name.textContent = s.host;
      li.appendChild(name);

      const label = doc.createElement('label');
      label.className = 'remote-writable';
      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.checked = remotes.isWritable(s.host);
      cb.addEventListener('change', async () => {
        await onSetWritable(s.host, cb.checked);
        setMessage(
          cb.checked ? `${s.host} への書き込みを許可しました` : `${s.host} は閲覧のみです`,
        );
      });
      label.appendChild(cb);
      label.appendChild(doc.createTextNode(' 書き込みを許可'));
      li.appendChild(label);

      const go = doc.createElement('button');
      go.type = 'button';
      go.textContent = '開く';
      go.addEventListener('click', () => {
        hostEl.value = s.host;
        pathEl.value = '';
        submit();
      });
      li.appendChild(go);

      const cut = doc.createElement('button');
      cut.type = 'button';
      cut.textContent = '切断';
      cut.addEventListener('click', async () => {
        await onDisconnect(s.host);
        await refresh();
        setMessage(`${s.host} を切断しました`);
      });
      li.appendChild(cut);

      listEl.appendChild(li);
    }
  }

  async function refresh() {
    try {
      sessions = (await getSessions()) || [];
    } catch {
      sessions = [];
    }
    renderSessions();
    renderCandidates();
  }

  /** 接続先を選び直したら、その接続先で最後に開いた場所とその書き込み許可を入れる。 */
  function syncFromHost() {
    const host = hostEl.value.trim();
    writeEl.checked = remotes.isWritable(host);
  }

  async function submit() {
    if (busy || !hostEl) return;
    const host = hostEl.value.trim();
    const uri = targetUri(host, pathEl.value);
    if (!uri) {
      setMessage('接続先を入力してください（例: k16 / user@host）', true);
      hostEl.focus();
      return;
    }
    busy = true;
    openBtn.disabled = true;
    openBtn.textContent = '接続中…';
    setMessage(`${host} に接続しています…`);
    try {
      await onOpen(uri, { host, writable: writeEl.checked });
      close();
    } catch (e) {
      setMessage(e && e.message ? e.message : String(e), true);
    } finally {
      busy = false;
      if (openBtn) {
        openBtn.disabled = false;
        openBtn.textContent = '開く';
      }
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Enter' && (e.target === hostEl || e.target === pathEl)) {
      e.preventDefault();
      submit();
    }
    // 本体のキーバインド（j/k 等）へ漏らさない
    e.stopPropagation();
  }

  /**
   * @param {{host?: string, path?: string}} [initial] 既に開いているリモートから呼ぶと、
   *   その接続先と場所が入った状態で始まる
   */
  function open(initial = {}) {
    if (!doc || !doc.body || overlay) return;
    overlay = doc.createElement('div');
    overlay.className = 'modal-overlay remote-overlay';
    const box = doc.createElement('div');
    box.className = 'modal remote-box';

    box.appendChild(
      createModalHeader(doc, {
        title: 'リモート接続（SSH / SFTP）',
        titleClass: 'remote-title',
        onClose: close,
      }),
    );

    const form = doc.createElement('div');
    form.className = 'remote-form';
    hostEl = doc.createElement('input');
    hostEl.type = 'text';
    hostEl.className = 'remote-host-input';
    hostEl.placeholder = '接続先（例: k16 / user@host）';
    hostEl.spellcheck = false;
    hostEl.autocomplete = 'off';
    hostEl.setAttribute('list', 'remote-host-candidates');
    datalistEl = doc.createElement('datalist');
    datalistEl.id = 'remote-host-candidates';
    pathEl = doc.createElement('input');
    pathEl.type = 'text';
    pathEl.className = 'remote-path-input';
    pathEl.placeholder = 'パス（空欄=ホーム, ~/x, /etc …）';
    pathEl.spellcheck = false;
    pathEl.autocomplete = 'off';
    openBtn = doc.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'remote-open';
    openBtn.textContent = '開く';
    openBtn.addEventListener('click', submit);
    form.append(hostEl, datalistEl, pathEl, openBtn);
    box.appendChild(form);

    const opt = doc.createElement('label');
    opt.className = 'remote-write-option';
    writeEl = doc.createElement('input');
    writeEl.type = 'checkbox';
    opt.appendChild(writeEl);
    opt.appendChild(
      doc.createTextNode(' 書き込みを許可する（既定は閲覧のみ。安全モードの切替も別に必要）'),
    );
    box.appendChild(opt);

    msgEl = doc.createElement('div');
    msgEl.className = 'remote-message';
    msgEl.setAttribute('role', 'status');
    box.appendChild(msgEl);

    const sub = doc.createElement('h3');
    sub.className = 'remote-subtitle';
    sub.textContent = '接続中';
    box.appendChild(sub);
    listEl = doc.createElement('ul');
    listEl.className = 'remote-list';
    box.appendChild(listEl);

    const note = doc.createElement('p');
    note.className = 'remote-note';
    note.textContent =
      'パスワード入力なしで `ssh 接続先` できること（鍵認証・ssh-agent など）が前提です。相手側に追加のインストールは要りません。';
    box.appendChild(note);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', onKey);
    hostEl.addEventListener('change', syncFromHost);
    doc.body.appendChild(overlay);

    const host = initial.host || remotes.recent()[0] || '';
    hostEl.value = host;
    pathEl.value = initial.path || '';
    writeEl.checked = host ? remotes.isWritable(host) : false;
    renderSessions();
    renderCandidates();
    refresh();
    Promise.resolve(getConfiguredHosts())
      .then((h) => {
        configured = Array.isArray(h) ? h : [];
        renderCandidates();
      })
      .catch(() => {});
    (host ? pathEl : hostEl).focus();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    hostEl = pathEl = writeEl = openBtn = msgEl = listEl = datalistEl = null;
  }

  return {
    open,
    close,
    toggle: (initial) => (isOpen() ? close() : open(initial)),
    isOpen,
  };
}
