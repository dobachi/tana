// navhistory.js — ペインごとのナビゲーション履歴（戻る/進む）(FR-17)
//
// ブラウザと同じモデル: 新しい場所を訪れると現在位置より先（forward 分）は
// 捨てて末尾に積む。back/forward は index を動かすだけで積まない。DOM も
// Tauri も持たない純粋な状態なのでそのままテストできる。
//
// ここで言う「戻る」は時系列の直前に居た場所であって親フォルダではない
// （お気に入り・場所・パス入力で飛んだ先も履歴に含む）。親へ上がる h/Backspace
// とは別物。

export function createNavHistory(limit = 200) {
  let stack = [];
  let idx = -1;

  return {
    /** 新しい場所を訪れた。現在と同じなら何もしない。前方履歴は破棄。 */
    visit(path) {
      if (!path || (idx >= 0 && stack[idx] === path)) return;
      stack = stack.slice(0, idx + 1);
      stack.push(path);
      // 上限を超えたら古い方から捨てる
      if (stack.length > limit) stack = stack.slice(stack.length - limit);
      idx = stack.length - 1;
    },
    /** 1つ戻る。移動先パスを返す。戻れないなら null（index は動かさない）。 */
    back() {
      if (idx <= 0) return null;
      idx -= 1;
      return stack[idx];
    },
    /** 1つ進む。移動先パスを返す。進めないなら null。 */
    forward() {
      if (idx < 0 || idx >= stack.length - 1) return null;
      idx += 1;
      return stack[idx];
    },
    canBack: () => idx > 0,
    canForward: () => idx >= 0 && idx < stack.length - 1,
    current: () => (idx >= 0 ? stack[idx] : null),
    /** テスト/デバッグ用のスナップショット */
    _state: () => ({ stack: stack.slice(), idx }),
  };
}
