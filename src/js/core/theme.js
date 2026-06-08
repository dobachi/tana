// theme.js — テーマ選択（サイバーダーク / 白基調シンプル）(NFR-U4)
// テーマは <html data-theme="..."> に反映し、選択を永続化する。

export const THEMES = Object.freeze(['cyber-dark', 'light']);
export const THEME_LABELS = Object.freeze({
  'cyber-dark': 'サイバーダーク',
  light: '白基調シンプル',
});
export const DEFAULT_THEME = 'cyber-dark';

const STORAGE_KEY = 'tana.theme';

/** テーマ状態を管理するファクトリ */
export function createTheme(initial) {
  let theme = THEMES.includes(initial) ? initial : DEFAULT_THEME;
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) fn(theme);
  }

  return {
    get() {
      return theme;
    },
    set(next) {
      const t = THEMES.includes(next) ? next : DEFAULT_THEME;
      if (t !== theme) {
        theme = t;
        emit();
      }
      return theme;
    },
    /** 次のテーマへ循環（cyber-dark ⇄ light） */
    toggle() {
      const i = THEMES.indexOf(theme);
      theme = THEMES[(i + 1) % THEMES.length];
      emit();
      return theme;
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(theme);
      return () => listeners.delete(fn);
    },
  };
}

/** 保存済みテーマを読み込む（無ければ既定） */
export function loadStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** テーマを永続化する */
export function storeTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage 不在時は無視 */
  }
}
