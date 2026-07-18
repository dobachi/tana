import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openSettings, closeSettings, isSettingsOpen } from '../core/settings.js';
import { createTheme } from '../core/theme.js';
import { createFontScale, toPercent } from '../core/fontscale.js';

let deps;
let hidden;

beforeEach(() => {
  hidden = false;
  deps = {
    theme: createTheme('cyber-dark'),
    fontScale: createFontScale(1.0),
    getShowHidden: () => hidden,
    setShowHidden: vi.fn((v) => {
      hidden = v;
    }),
  };
});

afterEach(() => {
  closeSettings();
  document.body.innerHTML = '';
});

const panel = () => document.querySelector('.settings-overlay');

describe('開閉', () => {
  it('開くとオーバーレイが1つできる', () => {
    openSettings(deps);
    expect(panel()).toBeTruthy();
    expect(isSettingsOpen()).toBe(true);
  });

  it('二重に開いても1つだけ', () => {
    openSettings(deps);
    openSettings(deps);
    expect(document.querySelectorAll('.settings-overlay')).toHaveLength(1);
  });

  it('×ボタンで閉じる', () => {
    openSettings(deps);
    document.querySelector('.settings-close').click();
    expect(panel()).toBeNull();
    expect(isSettingsOpen()).toBe(false);
  });

  it('閉じるボタンで閉じる', () => {
    openSettings(deps);
    document.querySelector('.btn-close-settings').click();
    expect(panel()).toBeNull();
  });

  it('背景クリックで閉じるが、パネル内クリックでは閉じない', () => {
    openSettings(deps);
    document.querySelector('.settings-panel').click();
    expect(panel()).toBeTruthy();

    panel().click();
    expect(panel()).toBeNull();
  });

  it('Escape で閉じる', () => {
    openSettings(deps);
    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
  });
});

describe('現在値の反映', () => {
  it('テーマの現在値が選択されている', () => {
    deps.theme.set('light');
    openSettings(deps);
    expect(document.querySelector('#setting-theme').value).toBe('light');
  });

  it('文字サイズの現在値がスライダーとラベルに出る', () => {
    deps.fontScale.set(1.3);
    openSettings(deps);
    expect(document.querySelector('#setting-fontscale').value).toBe('130');
    expect(document.querySelector('#setting-fontscale-value').textContent).toBe('130%');
  });

  it('隠しファイルの現在値がチェックに出る', () => {
    hidden = true;
    openSettings(deps);
    expect(document.querySelector('#setting-show-hidden').checked).toBe(true);
  });
});

describe('変更が即座に反映される', () => {
  it('テーマを変えると theme に伝わる', () => {
    openSettings(deps);
    const sel = document.querySelector('#setting-theme');
    sel.value = 'light';
    sel.dispatchEvent(new Event('change'));
    expect(deps.theme.get()).toBe('light');
  });

  it('スライダーを動かすと文字サイズが変わる', () => {
    openSettings(deps);
    const slider = document.querySelector('#setting-fontscale');
    slider.value = '120';
    slider.dispatchEvent(new Event('input'));
    expect(toPercent(deps.fontScale.get())).toBe(120);
    expect(document.querySelector('#setting-fontscale-value').textContent).toBe('120%');
  });

  it('範囲外の値はクランプされ、スライダー表示も実値に揃う', () => {
    openSettings(deps);
    const slider = document.querySelector('#setting-fontscale');
    slider.value = '400'; // MAX_SCALE(160%) を超える
    slider.dispatchEvent(new Event('input'));
    expect(toPercent(deps.fontScale.get())).toBe(160);
    expect(slider.value).toBe('160');
    expect(document.querySelector('#setting-fontscale-value').textContent).toBe('160%');
  });

  it('チェックを入れると setShowHidden が呼ばれる', () => {
    openSettings(deps);
    const cb = document.querySelector('#setting-show-hidden');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(deps.setShowHidden).toHaveBeenCalledWith(true);
  });
});
