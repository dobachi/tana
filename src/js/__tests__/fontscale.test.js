import { describe, it, expect, vi } from 'vitest';
import {
  createFontScale,
  clampScale,
  toPercent,
  MIN_SCALE,
  MAX_SCALE,
  DEFAULT_SCALE,
} from '../core/fontscale.js';

describe('clampScale', () => {
  it('範囲内はそのまま（丸め）', () => {
    expect(clampScale(1.0)).toBe(1.0);
    expect(clampScale(1.234)).toBe(1.23);
  });
  it('下限・上限でクランプ', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(9)).toBe(MAX_SCALE);
  });
  it('不正値・非有限は既定に丸める', () => {
    expect(clampScale(NaN)).toBe(DEFAULT_SCALE);
    expect(clampScale('big')).toBe(DEFAULT_SCALE);
    expect(clampScale(Infinity)).toBe(DEFAULT_SCALE);
  });
});

describe('toPercent', () => {
  it('百分率の整数にする', () => {
    expect(toPercent(1.0)).toBe(100);
    expect(toPercent(1.2)).toBe(120);
    expect(toPercent(0.8)).toBe(80);
  });
});

describe('createFontScale', () => {
  it('既定は 100%', () => {
    const fs = createFontScale();
    expect(fs.get()).toBe(DEFAULT_SCALE);
  });
  it('increase / decrease は STEP 刻みでクランプ', () => {
    const fs = createFontScale(MAX_SCALE);
    expect(fs.increase()).toBe(MAX_SCALE); // 上限超えない
    const fs2 = createFontScale(MIN_SCALE);
    expect(fs2.decrease()).toBe(MIN_SCALE); // 下限割らない
    const fs3 = createFontScale(1.0);
    expect(fs3.increase()).toBe(1.1);
    expect(fs3.decrease()).toBe(1.0);
  });
  it('reset で既定に戻る', () => {
    const fs = createFontScale(1.4);
    expect(fs.reset()).toBe(DEFAULT_SCALE);
  });
  it('set はクランプして適用', () => {
    const fs = createFontScale();
    expect(fs.set(2.0)).toBe(MAX_SCALE);
  });
  it('subscribe は即時通知し変更で呼ばれる', () => {
    const fs = createFontScale(1.0);
    const fn = vi.fn();
    const off = fs.subscribe(fn);
    expect(fn).toHaveBeenCalledWith(1.0);
    fs.increase();
    expect(fn).toHaveBeenCalledWith(1.1);
    off();
    fs.increase();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
