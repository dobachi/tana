// help.js — キーボードショートカット一覧（ヘルプ画面）
// `?` / `F1` でトグル、Esc で閉じる。内容はここのデータ駆動。
// 用途別の節に分け、上の欄に打った語で絞り込める（例: 「パス」「ctrl+l」）。

import { createModalHeader } from './modalheader.js';

export const SHORTCUTS = [
  {
    section: '移動',
    items: [
      ['j / k', 'カーソル 下 / 上'],
      ['g / G', '先頭 / 末尾へ'],
      ['l / Enter', 'フォルダの中へ（ファイルは既定アプリで開く）'],
      ['h', '親フォルダへ'],
      ['Ctrl + L', 'パスを入力して移動（~ や相対パス、sftp://接続先/パス も可）'],
      ['Alt + ← / →', '履歴を戻る / 進む（マウスの戻る/進むボタンでも可）'],
      ['Ctrl + D', '現在のフォルダをお気に入りに追加'],
    ],
  },
  {
    section: '検索',
    items: [['/ または Ctrl + F', '現在のフォルダ内を検索（名前・本文。Esc で閉じる）']],
  },
  {
    section: 'ペイン・タブ・サイドバー',
    items: [
      ['Tab', 'ペイン切替（左 ⇄ 右）'],
      ['Ctrl + T / W', 'タブを開く / 閉じる'],
      ['Ctrl + Shift + N', '新しいウィンドウ（今のフォルダ。フォルダの右クリックからも）'],
      ['Ctrl + Shift + W', 'ウィンドウを閉じる'],
      ['Ctrl + Tab / Ctrl + Shift + Tab', '次 / 前のタブ'],
      ['t → h / l', 'タブを左 / 右へ移動'],
      ['Ctrl + B', 'サイドバーへ: ペイン → 場所 → お気に入り → ペイン'],
    ],
  },
  {
    section: '開く',
    items: [
      ['o → o / r', '既定のアプリで開く / ファイルマネージャで表示'],
      ['o → 1…9', '設定に登録した外部アプリで開く（設定 → 外部アプリ）'],
      ['o → a', '別のアプリで開く（コマンド名を入力）'],
      ['o → w / e', 'WSL: Windows の既定アプリで開く / エクスプローラーで表示'],
      ['Shift + F10 / ≣', '右クリックメニューを開く'],
    ],
  },
  {
    section: 'リモート（SSH / SFTP）',
    items: [
      ['Ctrl + Shift + X / o → s', 'リモート接続の画面を開く'],
      ['sftp://接続先/パス', 'Ctrl + L の欄に入力すると、リモートの場所へ直接移動'],
    ],
  },
  {
    section: '選択',
    items: [
      ['Space', '選択をトグル（カーソルは1つ下へ）'],
      ['Ctrl + A', 'すべて選択'],
      ['Esc', '選択を解除'],
      ['Ctrl + クリック', '1件ずつ選択に追加 / 除外'],
      ['Shift + クリック', '範囲を選択'],
    ],
  },
  {
    section: 'パス・名前のコピー',
    items: [['y → p / n / d', 'パス / 名前 / 現在地のパス をクリップボードへ']],
  },
  {
    section: 'ファイル操作（操作モードのみ）',
    items: [
      ['F5 / F6', '反対のペインへ コピー / 移動'],
      ['Ctrl + C / X', 'コピー / 切り取り を登録'],
      ['Ctrl + V', '今の場所へ貼り付け'],
      ['ドラッグ', '反対のペインやフォルダへコピー'],
      ['F2', '名前の変更'],
      ['Shift + F4', '新しいファイル（空）'],
      ['F7', '新しいフォルダ'],
      ['Delete', 'ゴミ箱へ削除'],
      ['Shift + Delete', '完全に削除'],
    ],
  },
  {
    section: 'お気に入り（一覧にフォーカスしているとき）',
    items: [
      ['j / k', '上 / 下'],
      ['Enter / l', '開く / フォルダを展開'],
      ['h', 'フォルダ・見出しを閉じる'],
      ['t', 'タグを編集（空白区切り）'],
      ['Alt + ↑ / ↓', '前 / 後ろへ移動（並べ替えが「手動」のとき）'],
      ['Alt + → / ←', '直前のフォルダへ入れる / フォルダから出す'],
      ['ドラッグ', '並べ替え。フォルダの中央に落とすとその中へ'],
      ['ダブルクリック', '名前を変更'],
      ['⇅ ボタン', '並べ替え（手動 / 名前順 / 登録日順）とまとめ方（接続先 / タグ）'],
      ['検索欄に #タグ', 'タグで絞り込む（上のチップでも可）'],
      ['Esc / Tab', 'ペインへ戻る'],
    ],
  },
  {
    section: '表示',
    items: [
      ['Ctrl + P', 'プレビューの表示 / 非表示'],
      ['Ctrl + H', '隠しファイルの表示 / 非表示'],
      ['Ctrl + R', '再読込（外部の変更は自動でも反映される）'],
      ['s → n / s / m / e', '並び替え: 名前 / サイズ / 更新日時 / 拡張子'],
      ['s → r', '並び順を反転（列見出しのクリックでも可）'],
      ['f → d / f / e', '絞り込み: フォルダだけ / ファイルだけ / 拡張子を指定（ペインごと）'],
      ['f → a', '絞り込みを解除（帯の × でも可）'],
      ['Ctrl + + / - / 0', '文字サイズ 拡大 / 縮小 / 元に戻す（Ctrl + ホイールでも可）'],
      ['Ctrl + Shift + B', 'メニューバーを隠す / 戻す'],
      ['Alt', 'メニューバーを開く（Alt + F / V / H で各メニュー）'],
      ['Ctrl + ,', '設定（テーマもここで切替）'],
    ],
  },
  {
    section: 'モード',
    items: [['Ctrl + Shift + Space', '安全モード（閲覧のみ） ⇄ 操作モード']],
  },
  {
    section: 'ヘルプ',
    items: [['? / F1', 'このヘルプを開く / 閉じる']],
  },
];

/** 絞り込み用に小文字化し、空白（全角含む）を1つにまとめる。 */
function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

/**
 * 絞り込み語に合う項目だけを残した一覧を返す（純粋）。
 * 語は空白区切りで、すべてがキー・説明・見出しのどこかに含まれれば合う。
 * 見出しに合えばその節の全項目を残す。項目の無くなった節は消す。
 * @param {typeof SHORTCUTS} sections
 * @param {string} query
 */
export function filterShortcuts(sections, query) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return sections;
  const out = [];
  for (const sec of sections) {
    const head = norm(sec.section);
    const items = sec.items.filter(([k, d]) => {
      const hay = `${head} ${norm(k)} ${norm(d)}`;
      // キーの「Ctrl + L」と入力の「ctrl+l」を同じに扱う
      const compact = hay.replace(/ /g, '');
      return words.every((w) => hay.includes(w) || compact.includes(w.replace(/ /g, '')));
    });
    if (items.length) out.push({ section: sec.section, items });
  }
  return out;
}

/**
 * ヘルプ画面コントローラを生成する。
 * @param {Document} [doc]
 */
export function createHelp(doc = typeof document !== 'undefined' ? document : null) {
  let overlay = null;
  let version = '';

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    // 絞り込み中の Esc はまず語を消す。空ならヘルプを閉じる
    const input = overlay && overlay.querySelector('.help-filter');
    if (input && input.value) {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      return;
    }
    close();
  }

  function close() {
    if (!overlay) return;
    doc.removeEventListener('keydown', onKey, true);
    overlay.remove();
    overlay = null;
  }

  function renderList(body, query) {
    body.replaceChildren();
    const sections = filterShortcuts(SHORTCUTS, query);
    if (!sections.length) {
      const p = doc.createElement('p');
      p.className = 'help-empty';
      p.textContent = '該当するショートカットはありません';
      body.appendChild(p);
      return;
    }
    for (const sec of sections) {
      const block = doc.createElement('section');
      block.className = 'help-block';
      const h = doc.createElement('h3');
      h.className = 'help-section';
      h.textContent = sec.section;
      const dl = doc.createElement('dl');
      dl.className = 'help-list';
      for (const [keys, desc] of sec.items) {
        const dt = doc.createElement('dt');
        dt.textContent = keys;
        const dd = doc.createElement('dd');
        dd.textContent = desc;
        dl.append(dt, dd);
      }
      block.append(h, dl);
      body.appendChild(block);
    }
  }

  function open() {
    if (!doc || !doc.body || overlay) return;
    overlay = doc.createElement('div');
    overlay.className = 'modal-overlay help-overlay';

    const box = doc.createElement('div');
    box.className = 'modal help-box';

    box.appendChild(
      createModalHeader(doc, {
        title: `キーボードショートカット${version ? ` — Tana v${version}` : ''}`,
        titleClass: 'help-title',
        onClose: close,
      }),
    );

    const input = doc.createElement('input');
    input.type = 'search';
    input.className = 'help-filter';
    input.placeholder = '絞り込み（例: パス、コピー、ctrl+l）';
    input.setAttribute('aria-label', 'ショートカットを絞り込む');
    box.appendChild(input);

    const body = doc.createElement('div');
    body.className = 'help-body';
    box.appendChild(body);
    renderList(body, '');
    input.addEventListener('input', () => renderList(body, input.value));

    const hint = doc.createElement('p');
    hint.className = 'help-hint';
    hint.textContent = 'メニューにも同じ操作があります。Esc / ? / F1 で閉じる';
    box.appendChild(hint);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    doc.body.appendChild(overlay);
    doc.addEventListener('keydown', onKey, true);
    input.focus();
  }

  function toggle() {
    if (overlay) close();
    else open();
  }

  return {
    open,
    close,
    toggle,
    isOpen: () => overlay !== null,
    setVersion: (v) => {
      version = v || '';
    },
  };
}
