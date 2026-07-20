// help.js — キーボードショートカット一覧（ヘルプ画面）
// `?` / `F1` でトグル、Esc で閉じる。内容はここのデータ駆動。

export const SHORTCUTS = [
  {
    section: 'ナビゲーション',
    items: [
      ['j / k', 'カーソル 下 / 上'],
      ['h', '親フォルダへ戻る'],
      ['l / Enter', 'フォルダを開く'],
      ['g / G', '先頭 / 末尾へ'],
      ['Tab', 'ペイン切替（左 ⇄ 右）'],
      ['Space', '選択をトグル（カーソルは1つ下へ）'],
      ['Ctrl + A', 'すべて選択'],
      ['Esc', '選択を解除'],
      ['Ctrl + クリック', '1件ずつ選択に追加/除外'],
      ['Shift + クリック', '範囲を選択'],
    ],
  },
  {
    section: 'ファイル操作（操作モードのみ）',
    items: [
      ['F5', '別ペインへコピー'],
      ['F6', '別ペインへ移動'],
      ['F2', '名前の変更'],
      ['F7', '新しいフォルダ'],
      ['Delete', 'ゴミ箱へ削除'],
      ['Shift + Delete', '完全に削除'],
    ],
  },
  {
    section: 'お気に入り',
    items: [
      ['Ctrl + D', '現在のフォルダを追加'],
      ['Ctrl + B', 'お気に入り ⇄ ペイン フォーカス移動'],
      ['Ctrl + L', 'パスを直接入力して移動（~ 展開・相対パス可）'],
      ['（一覧で）j / k', '上 / 下'],
      ['（一覧で）Enter / l', '開く / フォルダ展開'],
      ['（一覧で）h', 'フォルダを閉じる'],
      ['（一覧で）Esc / Tab', 'ペインへ戻る'],
      ['ダブルクリック', '名前を変更'],
    ],
  },
  {
    section: '表示',
    items: [
      ['Ctrl + P', 'プレビューの表示/非表示（下に表示）'],
      ['Ctrl + H', '隠しファイルの表示/非表示'],
      ['Ctrl + Shift + B', 'メニューバーを隠す/戻す'],
      ['Alt', 'メニューバーを開く（Alt+F / V / H で各メニュー、↑↓←→で移動）'],
      ['Ctrl + ,', '設定を開く（テーマ切替はここ、または表示メニュー）'],
      ['Ctrl + + / - / 0', '文字サイズ 拡大 / 縮小 / リセット（ステータスバーの A- / A+ でも可）'],
    ],
  },
  {
    section: 'モード',
    items: [['Ctrl + Shift + Space', '安全モード ⇄ 操作モード']],
  },
  {
    section: 'ヘルプ',
    items: [
      ['? / F1', 'このヘルプを表示/閉じる'],
      ['Esc', '閉じる'],
    ],
  },
];

/**
 * ヘルプ画面コントローラを生成する。
 * @param {Document} [doc]
 */
export function createHelp(doc = typeof document !== 'undefined' ? document : null) {
  let overlay = null;

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  }

  function close() {
    if (!overlay) return;
    doc.removeEventListener('keydown', onKey, true);
    overlay.remove();
    overlay = null;
  }

  function open() {
    if (!doc || !doc.body || overlay) return;
    overlay = doc.createElement('div');
    overlay.className = 'modal-overlay help-overlay';

    const box = doc.createElement('div');
    box.className = 'modal help-box';

    const title = doc.createElement('h2');
    title.className = 'help-title';
    title.textContent = 'キーボードショートカット';
    box.appendChild(title);

    for (const sec of SHORTCUTS) {
      const h = doc.createElement('h3');
      h.className = 'help-section';
      h.textContent = sec.section;
      box.appendChild(h);

      const dl = doc.createElement('dl');
      dl.className = 'help-list';
      for (const [keys, desc] of sec.items) {
        const dt = doc.createElement('dt');
        dt.textContent = keys;
        const dd = doc.createElement('dd');
        dd.textContent = desc;
        dl.append(dt, dd);
      }
      box.appendChild(dl);
    }

    const hint = doc.createElement('p');
    hint.className = 'help-hint';
    hint.textContent = 'Esc または ? で閉じる';
    box.appendChild(hint);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    doc.body.appendChild(overlay);
    doc.addEventListener('keydown', onKey, true);
  }

  function toggle() {
    if (overlay) close();
    else open();
  }

  return { open, close, toggle, isOpen: () => overlay !== null };
}
