// editmenu.js — メニューバー「編集」ドロップダウンの項目を組み立てる純粋ロジック。
//
// 右クリックメニュー（filepane がクリックした行を対象にする）に対し、こちらは
// F5/F6 等のキーボード操作と同じくアクティブペインの対象（選択があればそれ、
// 無ければカーソル行）に効く。対象や宛先が無いときの無効化判定をここに集約し、
// DOM/Tauri 非依存で単体テストできるようにする。app.js は状態と action を注入する。

/**
 * @param {object} state
 * @param {number} state.targetCount 操作対象の件数（選択 or カーソル1件）
 * @param {boolean} state.hasDest 反対のペインに宛先ディレクトリがあるか
 * @param {boolean} state.hasCursor カーソル行があるか（リネームの可否）
 * @param {object} actions 各項目の実行関数（copy/move/rename/trash/deletePermanent/makeFolder）
 * @returns {object[]} showMenu / menubar が解釈する項目配列
 */
export function buildEditMenuItems(state, actions) {
  const { targetCount = 0, hasDest = false, hasCursor = false } = state || {};
  const a = actions || {};
  const hasTarget = targetCount > 0;
  const suffix = targetCount > 1 ? `（${targetCount} 件）` : '';
  return [
    {
      label: `反対のペインへコピー${suffix}`,
      shortcut: 'F5',
      disabled: !hasTarget || !hasDest,
      action: a.copy,
    },
    {
      label: `反対のペインへ移動${suffix}`,
      shortcut: 'F6',
      disabled: !hasTarget || !hasDest,
      action: a.move,
    },
    { separator: true },
    // リネームは対象が1つに定まる必要があるのでカーソル行のみ
    { label: '名前を変更…', shortcut: 'F2', disabled: !hasCursor, action: a.rename },
    {
      label: `ゴミ箱へ${suffix}`,
      shortcut: 'Delete',
      danger: true,
      disabled: !hasTarget,
      action: a.trash,
    },
    {
      label: `完全に削除${suffix}`,
      shortcut: 'Shift+Delete',
      danger: true,
      disabled: !hasTarget,
      action: a.deletePermanent,
    },
    { separator: true },
    { label: '新しいフォルダ…', shortcut: 'F7', action: a.makeFolder },
  ];
}
