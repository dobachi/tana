import { describe, it, expect } from 'vitest';
import {
  VIEW,
  ICON_SIZES,
  DEFAULT_ICON_SIZE,
  ICON_SIZE_KEY,
  VIEW_KEY_PREFIX,
  normalizeView,
  clampIconSize,
  stepIconSize,
  loadView,
  storeView,
  loadIconSize,
  storeIconSize,
  thumbPxFor,
  columnsFromTops,
  gridMove,
  glyphFor,
} from '../core/iconview.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const broken = {
  getItem: () => {
    throw new Error('x');
  },
  setItem: () => {
    throw new Error('x');
  },
};

describe('表示の種類', () => {
  it('壊れた値は詳細', () => {
    expect(normalizeView('icons')).toBe(VIEW.ICONS);
    expect(normalizeView('details')).toBe(VIEW.DETAILS);
    expect(normalizeView('grid')).toBe(VIEW.DETAILS);
    expect(normalizeView(null)).toBe(VIEW.DETAILS);
  });

  it('ペインごとに保存・読み込み（既定は詳細）', () => {
    const s = memStorage();
    expect(loadView('left', s)).toBe(VIEW.DETAILS);
    storeView('left', VIEW.ICONS, s);
    expect(s.getItem(VIEW_KEY_PREFIX + 'left')).toBe('icons');
    expect(loadView('left', s)).toBe(VIEW.ICONS);
    expect(loadView('right', s)).toBe(VIEW.DETAILS);
    expect(loadView('left', broken)).toBe(VIEW.DETAILS);
    expect(() => storeView('left', VIEW.ICONS, broken)).not.toThrow();
  });
});

describe('アイコンの大きさ', () => {
  it('範囲に収める', () => {
    expect(clampIconSize(-3)).toBe(0);
    expect(clampIconSize(99)).toBe(ICON_SIZES.length - 1);
    expect(clampIconSize('2')).toBe(2);
    expect(clampIconSize('abc')).toBe(DEFAULT_ICON_SIZE);
  });

  it('1 段ずつ。端では止まる', () => {
    expect(stepIconSize(1, 1)).toBe(2);
    expect(stepIconSize(1, -1)).toBe(0);
    expect(stepIconSize(0, -1)).toBe(0);
    expect(stepIconSize(ICON_SIZES.length - 1, 1)).toBe(ICON_SIZES.length - 1);
    expect(stepIconSize(2, 0)).toBe(2);
  });

  it('保存・読み込み（既定は中）', () => {
    const s = memStorage();
    expect(loadIconSize(s)).toBe(DEFAULT_ICON_SIZE);
    storeIconSize(3, s);
    expect(s.getItem(ICON_SIZE_KEY)).toBe('3');
    expect(loadIconSize(s)).toBe(3);
    s.setItem(ICON_SIZE_KEY, '42');
    expect(loadIconSize(s)).toBe(ICON_SIZES.length - 1);
    expect(loadIconSize(broken)).toBe(DEFAULT_ICON_SIZE);
  });

  it('大きいほど枠も大きい', () => {
    for (let i = 1; i < ICON_SIZES.length; i++) {
      expect(ICON_SIZES[i].em).toBeGreaterThan(ICON_SIZES[i - 1].em);
    }
  });
});

describe('thumbPxFor', () => {
  it('粗く見えない最小の大きさを選ぶ', () => {
    expect(thumbPxFor(42, 1)).toBe(64);
    expect(thumbPxFor(42, 2)).toBe(128);
    expect(thumbPxFor(63, 2)).toBe(128);
    expect(thumbPxFor(126, 2)).toBe(256);
    expect(thumbPxFor(400, 2)).toBe(256); // 上限
    expect(thumbPxFor(10)).toBe(64);
    expect(thumbPxFor(NaN, 0)).toBe(64);
  });
});

describe('columnsFromTops', () => {
  it('先頭と同じ段の数', () => {
    expect(columnsFromTops([0, 0, 0, 80, 80])).toBe(3);
    expect(columnsFromTops([0, 0.4, 80])).toBe(2);
    expect(columnsFromTops([5])).toBe(1);
    expect(columnsFromTops([])).toBe(1);
    expect(columnsFromTops(null)).toBe(1);
  });
});

describe('gridMove（4 列 × 10 件: 0-3 / 4-7 / 8-9）', () => {
  const m = (i, d) => gridMove(i, d, 4, 10);
  it('左右は前後の 1 つ（段の端では次の段へ）、両端で止まる', () => {
    expect(m(5, 'left')).toBe(4);
    expect(m(4, 'left')).toBe(3);
    expect(m(3, 'right')).toBe(4);
    expect(m(0, 'left')).toBe(0);
    expect(m(9, 'right')).toBe(9);
  });

  it('上下は 1 段。最初の段で上は動かない', () => {
    expect(m(5, 'up')).toBe(1);
    expect(m(1, 'up')).toBe(1);
    expect(m(1, 'down')).toBe(5);
  });

  it('下の段が短ければその最後へ。最後の段では動かない', () => {
    expect(m(6, 'down')).toBe(9);
    expect(m(7, 'down')).toBe(9);
    expect(m(4, 'down')).toBe(8);
    expect(m(9, 'down')).toBe(9);
    expect(m(8, 'down')).toBe(8);
  });

  it('列数 1（詳細と同じ並び）・空・範囲外', () => {
    expect(gridMove(2, 'down', 1, 5)).toBe(3);
    expect(gridMove(2, 'up', 0, 5)).toBe(1);
    expect(gridMove(0, 'down', 4, 0)).toBe(0);
    expect(gridMove(99, 'left', 4, 10)).toBe(8);
    expect(gridMove(3, 'nowhere', 4, 10)).toBe(3);
  });
});

describe('glyphFor', () => {
  it('フォルダ / ファイル / 親', () => {
    expect(glyphFor({ is_dir: true })).toBe('📁');
    expect(glyphFor({ is_dir: false })).toBe('📄');
    expect(glyphFor({ is_dir: true, is_parent: true })).toBe('⬆');
    expect(glyphFor(null)).toBe('');
  });
});
