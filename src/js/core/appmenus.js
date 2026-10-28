// appmenus.js — メニューバーの「ファイル」「編集（後半）」「移動」の項目を組み立てる純粋ロジック。
//
// ヘルプ（help.js）に載っているキー操作は、キーを覚えていなくてもメニューから辿れるようにする。
// ここは項目の並び・ラベル・ショートカット表記・無効化判定だけを持ち、実行は app.js が
// actions として注入する（editmenu.js と同じ方式）。DOM/Tauri 非依存で単体テストできる。

/**
 * ファイル(F)。先頭はカーソル行を「開く」系（ヘルプの o → … と同じ）。
 * @param {object} state
 * @param {boolean} state.hasEntry カーソル行があるか
 * @param {boolean} state.wsl WSL か（Windows 側で開く項目を出す）
 * @param {boolean} state.safe 安全モードか（切替項目のラベル用）
 * @param {object} a actions
 */
export function buildFileMenuItems(state, a = {}) {
  const { hasEntry = false, wsl = false, safe = true } = state || {};
  const items = [
    { label: '既定のアプリで開く', shortcut: 'o → o', disabled: !hasEntry, action: a.openApp },
    {
      label: 'ファイルマネージャで表示',
      shortcut: 'o → r',
      disabled: !hasEntry,
      action: a.reveal,
    },
    {
      label: '別のアプリで開く…',
      shortcut: 'o → 1…9 / a',
      disabled: !hasEntry,
      action: a.openWith,
    },
  ];
  if (wsl) {
    items.push(
      {
        label: 'Windows の既定アプリで開く',
        shortcut: 'o → w',
        disabled: !hasEntry,
        action: a.openWindows,
      },
      {
        label: 'エクスプローラーで表示',
        shortcut: 'o → e',
        disabled: !hasEntry,
        action: a.explorer,
      },
    );
  }
  items.push(
    { separator: true },
    { label: '新しいタブ', shortcut: 'Ctrl+T', action: a.newTab },
    { label: 'タブを閉じる', shortcut: 'Ctrl+W', action: a.closeTab },
    { separator: true },
    { label: 'リモート接続…（SSH / SFTP）', shortcut: 'Ctrl+Shift+X', action: a.remote },
    { label: 'ワークスペース…（タブ構成の保存/復元）', action: a.workspaces },
    { label: 'お気に入りに現在地を追加', shortcut: 'Ctrl+D', action: a.addFavorite },
    { separator: true },
    {
      label: safe ? '操作モードに切り替える' : '安全モード（閲覧のみ）に戻す',
      shortcut: 'Ctrl+Shift+Space',
      action: a.toggleMode,
    },
    { separator: true },
    { label: '終了', action: a.quit },
  );
  return items;
}

/**
 * 編集(E) の後半: ファイルのクリップボード・選択・パス/名前のコピー。
 * 前半（F5/F6/F2/Delete/F7）は editmenu.js。
 * @param {object} state
 * @param {number} state.targetCount 操作対象の件数
 * @param {boolean} state.canPaste 貼り付けられるものがあるか
 * @param {boolean} state.hasSelection 選択があるか
 * @param {boolean} state.hasEntry カーソル行があるか
 * @param {object} a actions
 */
export function buildEditExtraItems(state, a = {}) {
  const { targetCount = 0, canPaste = false, hasSelection = false, hasEntry = false } = state || {};
  const suffix = targetCount > 1 ? `（${targetCount} 件）` : '';
  return [
    { label: `コピー${suffix}`, shortcut: 'Ctrl+C', disabled: !targetCount, action: a.copy },
    { label: `切り取り${suffix}`, shortcut: 'Ctrl+X', disabled: !targetCount, action: a.cut },
    { label: 'ここへ貼り付け', shortcut: 'Ctrl+V', disabled: !canPaste, action: a.paste },
    { separator: true },
    { label: 'すべて選択', shortcut: 'Ctrl+A', action: a.selectAll },
    { label: '選択を解除', shortcut: 'Esc', disabled: !hasSelection, action: a.clearSelection },
    { separator: true },
    { label: 'パスをコピー', shortcut: 'y → p', disabled: !hasEntry, action: a.copyPath },
    { label: '名前をコピー', shortcut: 'y → n', disabled: !hasEntry, action: a.copyName },
    { label: '現在地のパスをコピー', shortcut: 'y → d', action: a.copyDir },
  ];
}

/**
 * 移動(G)。
 * @param {object} state
 * @param {boolean} state.canBack @param {boolean} state.canForward
 * @param {object} a actions
 */
export function buildGoMenuItems(state, a = {}) {
  const { canBack = true, canForward = true } = state || {};
  return [
    { label: '親フォルダへ', shortcut: 'h', action: a.parent },
    { label: '戻る', shortcut: 'Alt+←', disabled: !canBack, action: a.back },
    { label: '進む', shortcut: 'Alt+→', disabled: !canForward, action: a.forward },
    { separator: true },
    { label: 'パスを入力して移動…', shortcut: 'Ctrl+L', action: a.pathInput },
    { label: 'このフォルダ内を検索…', shortcut: 'Ctrl+F', action: a.search },
    { separator: true },
    { label: '反対のペインへ', shortcut: 'Tab', action: a.otherPane },
    { label: '次のタブ', shortcut: 'Ctrl+Tab', action: a.nextTab },
    { label: '前のタブ', shortcut: 'Ctrl+Shift+Tab', action: a.prevTab },
    { label: 'タブを左へ移動', shortcut: 't → h', action: a.tabLeft },
    { label: 'タブを右へ移動', shortcut: 't → l', action: a.tabRight },
    { separator: true },
    { label: 'サイドバーへ（場所 → お気に入り）', shortcut: 'Ctrl+B', action: a.sidebar },
  ];
}
