// previewplacement.js — プレビューの開閉・配置(右/下)・分割比率の真実源 (FR-09)
// theme.js と同型のファクトリ + localStorage 永続化。状態は #app の
// data-preview 属性（既存の data-theme / data-mode と同じ流儀）に反映する。

export const PLACEMENTS = Object.freeze(['right', 'bottom']);
export const DEFAULT_PLACEMENT = 'right';
export const DEFAULT_RATIO = 0.32;
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.7;

const STORAGE_KEY = 'tana.preview';

function clampRatio(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return DEFAULT_RATIO;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, n));
}

/**
 * プレビュー配置状態のファクトリ。
 * @param {{open?:boolean, placement?:string, ratio?:number}} [initial]
 */
export function createPreviewPlacement(initial = {}) {
  let open = Boolean(initial.open);
  let placement = PLACEMENTS.includes(initial.placement) ? initial.placement : DEFAULT_PLACEMENT;
  let ratio = clampRatio(initial.ratio ?? DEFAULT_RATIO);
  const listeners = new Set();

  function state() {
    return { open, placement, ratio };
  }
  function emit() {
    const s = state();
    for (const fn of listeners) fn(s);
  }

  return {
    get: state,
    isOpen() {
      return open;
    },
    open() {
      if (!open) {
        open = true;
        emit();
      }
      return open;
    },
    close() {
      if (open) {
        open = false;
        emit();
      }
      return open;
    },
    toggle() {
      open = !open;
      emit();
      return open;
    },
    getPlacement() {
      return placement;
    },
    setPlacement(next) {
      const p = PLACEMENTS.includes(next) ? next : placement;
      if (p !== placement) {
        placement = p;
        emit();
      }
      return placement;
    },
    /** 右 ⇄ 下 を切り替える */
    togglePlacement() {
      placement = placement === 'right' ? 'bottom' : 'right';
      emit();
      return placement;
    },
    getRatio() {
      return ratio;
    },
    setRatio(next) {
      if (!Number.isFinite(Number(next))) return ratio; // 不正値は現状維持
      const r = clampRatio(next);
      if (r !== ratio) {
        ratio = r;
        emit();
      }
      return ratio;
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state());
      return () => listeners.delete(fn);
    },
  };
}

/** 保存済み設定を読み込む（無ければ既定）。不正値は既定へフォールバック。 */
export function loadStoredPlacement(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return { open: false, placement: DEFAULT_PLACEMENT, ratio: DEFAULT_RATIO };
    const o = JSON.parse(raw);
    return {
      open: Boolean(o.open),
      placement: PLACEMENTS.includes(o.placement) ? o.placement : DEFAULT_PLACEMENT,
      ratio: clampRatio(o.ratio),
    };
  } catch {
    return { open: false, placement: DEFAULT_PLACEMENT, ratio: DEFAULT_RATIO };
  }
}

/** 設定を永続化する。 */
export function storePlacement(state, storage = safeStorage()) {
  try {
    if (!storage) return;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        open: Boolean(state.open),
        placement: PLACEMENTS.includes(state.placement) ? state.placement : DEFAULT_PLACEMENT,
        ratio: clampRatio(state.ratio),
      }),
    );
  } catch {
    // 永続化失敗は無視（プライベートモード等）
  }
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
