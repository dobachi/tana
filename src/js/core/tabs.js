// tabs.js — ペインごとのタブの純粋な状態 (FR-08)
//
// 各タブは「ディレクトリ + 表示状態(カーソル/選択)」を持つ。ここは並び・アクティブ
// 管理だけを担う純粋ロジックで、実際の読み込み/保存は app 側（filepane の
// getViewState/applyViewState と結線）。DOM も Tauri も持たないのでテスト可能。

export function createTabList(firstDir, firstState = null) {
  let tabs = [{ dir: firstDir, state: firstState }];
  let active = 0;

  const clamp = () => {
    active = Math.max(0, Math.min(active, tabs.length - 1));
  };

  return {
    /** タブのスナップショット（{dir, state} の配列） */
    list: () => tabs.map((t) => ({ dir: t.dir, state: t.state })),
    count: () => tabs.length,
    activeIndex: () => active,
    active: () => tabs[active],

    /** アクティブの直後に新規タブを挿入し、それをアクティブにする。 */
    add: (dir, state = null) => {
      tabs.splice(active + 1, 0, { dir, state });
      active += 1;
      return active;
    },

    /** index のタブを閉じる。最後の1枚は残す（false を返す）。 */
    close: (index = active) => {
      if (tabs.length <= 1) return false;
      if (index < 0 || index >= tabs.length) return false;
      tabs.splice(index, 1);
      if (index < active) active -= 1;
      else if (index === active) active = Math.min(active, tabs.length - 1);
      clamp();
      return true;
    },

    activate: (index) => {
      if (index >= 0 && index < tabs.length) active = index;
      return active;
    },
    next: () => {
      active = (active + 1) % tabs.length;
      return active;
    },
    prev: () => {
      active = (active - 1 + tabs.length) % tabs.length;
      return active;
    },

    setActiveDir: (dir) => {
      if (dir) tabs[active].dir = dir;
    },
    setActiveState: (state) => {
      tabs[active].state = state;
    },
  };
}
