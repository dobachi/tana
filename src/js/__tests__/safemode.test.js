import { describe, it, expect, vi } from 'vitest';
import { createSafeMode, MODE } from '../core/safemode.js';

describe('safemode', () => {
  it('既定は安全モード (NFR-R1)', () => {
    const sm = createSafeMode();
    expect(sm.get()).toBe(MODE.SAFE);
    expect(sm.isSafe()).toBe(true);
  });

  it('安全モードでは破壊的操作を禁止する', () => {
    const sm = createSafeMode();
    expect(sm.canMutate()).toBe(false);
  });

  it('toggle で操作モードに切り替わり、破壊的操作が許可される', () => {
    const sm = createSafeMode();
    expect(sm.toggle()).toBe(MODE.OPERATION);
    expect(sm.canMutate()).toBe(true);
    expect(sm.toggle()).toBe(MODE.SAFE);
    expect(sm.canMutate()).toBe(false);
  });

  it('set で明示設定でき、不正値は安全モードに丸める', () => {
    const sm = createSafeMode();
    expect(sm.set(MODE.OPERATION)).toBe(MODE.OPERATION);
    expect(sm.set('garbage')).toBe(MODE.SAFE);
  });

  it('subscribe は初期値で即時通知し、変更時に呼ばれる', () => {
    const sm = createSafeMode();
    const fn = vi.fn();
    const off = sm.subscribe(fn);
    expect(fn).toHaveBeenCalledWith(MODE.SAFE);
    sm.toggle();
    expect(fn).toHaveBeenCalledWith(MODE.OPERATION);
    off();
    sm.toggle();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
