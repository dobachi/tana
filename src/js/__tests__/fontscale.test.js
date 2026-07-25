import { describe, it, expect, vi } from 'vitest';
import {
  fontScaleAction,
  wheelFontScaleAction,
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
    expect(fs.set(9)).toBe(MAX_SCALE);
    expect(fs.set(0.1)).toBe(MIN_SCALE);
  });
  it('上限は 200%（従来の 160% から引き上げ）', () => {
    expect(MAX_SCALE).toBe(2.0);
    const fs = createFontScale(1.9);
    expect(fs.increase()).toBe(2.0); // 1.6 で頭打ちにならない
    expect(toPercent(fs.get())).toBe(200);
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

describe('fontScaleAction', () => {
  const ev = (o) => ({ ctrlKey: true, ...o });

  it('US配列: Ctrl+= / Ctrl+- / Ctrl+0', () => {
    expect(fontScaleAction(ev({ key: '=', code: 'Equal' }))).toBe('increase');
    expect(fontScaleAction(ev({ key: '-', code: 'Minus' }))).toBe('decrease');
    expect(fontScaleAction(ev({ key: '0', code: 'Digit0' }))).toBe('reset');
  });

  it('Shift併用: Ctrl+Shift+; が + になる配列でも拡大できる', () => {
    expect(fontScaleAction(ev({ key: '+', code: 'Semicolon', shiftKey: true }))).toBe('increase');
    expect(fontScaleAction(ev({ key: '_', code: 'Minus', shiftKey: true }))).toBe('decrease');
  });

  // 回帰: e.key だけを見ていたため、配列によっては無反応だった。
  it('e.key が期待値でなくても物理キー(e.code)で判定する', () => {
    expect(fontScaleAction(ev({ key: 'Dead', code: 'Equal' }))).toBe('increase');
    expect(fontScaleAction(ev({ key: '‐', code: 'Minus' }))).toBe('decrease');
    expect(fontScaleAction(ev({ key: '０', code: 'Digit0' }))).toBe('reset');
  });

  it('テンキーにも対応する', () => {
    expect(fontScaleAction(ev({ key: '+', code: 'NumpadAdd' }))).toBe('increase');
    expect(fontScaleAction(ev({ key: '-', code: 'NumpadSubtract' }))).toBe('decrease');
    expect(fontScaleAction(ev({ key: '0', code: 'Numpad0' }))).toBe('reset');
  });

  it('Ctrl なし・Alt/Meta 併用は対象外', () => {
    expect(fontScaleAction({ key: '=', code: 'Equal' })).toBeNull();
    expect(fontScaleAction(ev({ key: '=', code: 'Equal', altKey: true }))).toBeNull();
    expect(fontScaleAction(ev({ key: '=', code: 'Equal', metaKey: true }))).toBeNull();
  });

  it('無関係なキーは null', () => {
    expect(fontScaleAction(ev({ key: 'a', code: 'KeyA' }))).toBeNull();
    expect(fontScaleAction(ev({ key: '1', code: 'Digit1' }))).toBeNull();
    expect(fontScaleAction(null)).toBeNull();
    expect(fontScaleAction(ev({}))).toBeNull();
  });
});

describe('wheelFontScaleAction', () => {
  const wheel = (o) => ({ ctrlKey: true, ...o });

  it('Ctrl+上スクロールで拡大、下スクロールで縮小（ブラウザと同じ向き）', () => {
    expect(wheelFontScaleAction(wheel({ deltaY: -120 }))).toBe('increase');
    expect(wheelFontScaleAction(wheel({ deltaY: 120 }))).toBe('decrease');
  });

  it('deltaY の大小に依らず1段（連続イベントで自然に増える）', () => {
    expect(wheelFontScaleAction(wheel({ deltaY: -3 }))).toBe('increase');
    expect(wheelFontScaleAction(wheel({ deltaY: 500 }))).toBe('decrease');
  });

  it('Ctrl なしは対象外（通常スクロールを奪わない）', () => {
    expect(wheelFontScaleAction({ deltaY: -120 })).toBeNull();
  });

  it('Alt/Meta/Shift 併用は対象外', () => {
    expect(wheelFontScaleAction(wheel({ deltaY: -120, altKey: true }))).toBeNull();
    expect(wheelFontScaleAction(wheel({ deltaY: -120, metaKey: true }))).toBeNull();
    expect(wheelFontScaleAction(wheel({ deltaY: -120, shiftKey: true }))).toBeNull();
  });

  it('縦移動が無ければ null（水平ホイールで誤爆しない）', () => {
    expect(wheelFontScaleAction(wheel({ deltaY: 0 }))).toBeNull();
    expect(wheelFontScaleAction(wheel({}))).toBeNull();
    expect(wheelFontScaleAction(null)).toBeNull();
  });
});
