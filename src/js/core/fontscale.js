// fontscale.js — 全体の文字サイズ設定（設定値の真実源, NFR-U5）
// CSS 変数 --font-scale に反映し、選択を永続化する。
// 将来の設定画面はこのモジュールの set/get を呼ぶだけでよい。

export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.6;
export const STEP = 0.1;
export const DEFAULT_SCALE = 1.0;

const STORAGE_KEY = 'tana.fontScale';

/** 倍率を [MIN, MAX] にクランプし、浮動小数誤差を丸める */
export function clampScale(v) {
  const n = typeof v === 'number' && isFinite(v) ? v : DEFAULT_SCALE;
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
  return Math.round(clamped * 100) / 100;
}

/** 倍率(0.8〜1.6)を百分率の整数にする（表示用） */
export function toPercent(scale) {
  return Math.round(scale * 100);
}

/**
 * キーイベントを文字サイズ操作に対応づける。
 *
 * `e.key` だけで判定すると、キーボード配列によって取りこぼす。JIS 配列の
 * `=` は Shift+`-`、`+` は Shift+`;` で、テンキーはさらに別。物理キーを表す
 * `e.code` を主に見て、`e.key` は補助にする（他のショートカットと同じ方針）。
 * @param {{key?: string, code?: string, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean}} e
 * @returns {'increase'|'decrease'|'reset'|null}
 */
export function fontScaleAction(e) {
  if (!e || !e.ctrlKey || e.altKey || e.metaKey) return null;
  const code = e.code || '';
  const key = e.key || '';
  if (code === 'Equal' || code === 'NumpadAdd' || key === '+' || key === '=') return 'increase';
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '_')
    return 'decrease';
  if (code === 'Digit0' || code === 'Numpad0' || key === '0') return 'reset';
  return null;
}

export function createFontScale(initial) {
  let scale = clampScale(initial);
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) fn(scale);
  }
  function apply(next) {
    const c = clampScale(next);
    if (c !== scale) {
      scale = c;
      emit();
    }
    return scale;
  }

  return {
    get() {
      return scale;
    },
    set(v) {
      return apply(v);
    },
    increase() {
      return apply(scale + STEP);
    },
    decrease() {
      return apply(scale - STEP);
    },
    reset() {
      return apply(DEFAULT_SCALE);
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(scale);
      return () => listeners.delete(fn);
    },
  };
}

/** 保存済み倍率を読み込む（無ければ既定） */
export function loadStoredFontScale() {
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_KEY));
    return isFinite(v) ? clampScale(v) : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}

/** 倍率を永続化する */
export function storeFontScale(scale) {
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    /* localStorage 不在時は無視 */
  }
}
