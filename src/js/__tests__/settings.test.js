import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openSettings, closeSettings, isSettingsOpen } from '../core/settings.js';
import { createTheme } from '../core/theme.js';
import { createFontScale, toPercent, MAX_SCALE } from '../core/fontscale.js';
import { createExtApps, QUICK_SLOTS } from '../core/extapps.js';

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
    const max = toPercent(MAX_SCALE);
    slider.value = '400'; // MAX_SCALE を超える
    slider.dispatchEvent(new Event('input'));
    expect(toPercent(deps.fontScale.get())).toBe(max);
    expect(slider.value).toBe(String(max));
    expect(document.querySelector('#setting-fontscale-value').textContent).toBe(`${max}%`);
  });

  it('チェックを入れると setShowHidden が呼ばれる', () => {
    openSettings(deps);
    const cb = document.querySelector('#setting-show-hidden');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(deps.setShowHidden).toHaveBeenCalledWith(true);
  });
});

// --- 外部アプリ（別のアプリで開く / FR-13） ---
describe('外部アプリ セクション', () => {
  const rows = () => document.querySelectorAll('.extapp-row');
  const openWithApps = (initial) => {
    const extApps = createExtApps(initial);
    openSettings({ ...deps, extApps });
    return extApps;
  };

  it('extApps を渡さないとセクションごと隠れる（既存の呼び出しを壊さない）', () => {
    openSettings(deps);
    expect(document.querySelector('#setting-extapps-group').style.display).toBe('none');
  });

  it('登録済みのアプリが番号付きで並ぶ', () => {
    openWithApps([
      { name: 'VS Code', command: 'code' },
      { name: 'GIMP', command: 'gimp' },
    ]);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].querySelector('.extapp-slot').textContent).toBe('1');
    expect(rows()[0].querySelector('.extapp-name').textContent).toBe('VS Code');
    expect(rows()[0].querySelector('.extapp-command').textContent).toBe('code');
    expect(rows()[1].querySelector('.extapp-slot').textContent).toBe('2');
  });

  it('10件目以降は二打鍵の番号を出さない', () => {
    openWithApps(
      Array.from({ length: QUICK_SLOTS + 1 }, (_, i) => ({ name: `a${i}`, command: `a${i}` })),
    );
    const slots = [...rows()].map((r) => r.querySelector('.extapp-slot').textContent);
    expect(slots[QUICK_SLOTS - 1]).toBe(String(QUICK_SLOTS));
    expect(slots[QUICK_SLOTS]).toBe('–');
  });

  it('追加すると一覧に増え、入力欄が空に戻る', () => {
    const extApps = openWithApps();
    document.querySelector('#setting-extapp-name').value = 'VS Code';
    document.querySelector('#setting-extapp-command').value = 'code';
    document.querySelector('#setting-extapp-add').click();
    expect(extApps.list().map((a) => a.command)).toEqual(['code']);
    expect(rows()).toHaveLength(1);
    expect(document.querySelector('#setting-extapp-command').value).toBe('');
  });

  it('コマンド欄で Enter を押しても追加できる', () => {
    const extApps = openWithApps();
    const cmd = document.querySelector('#setting-extapp-command');
    cmd.value = 'gimp';
    cmd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(extApps.list()).toHaveLength(1);
  });

  it('不正な入力は理由を表示し、一覧を変えない', () => {
    const extApps = openWithApps();
    document.querySelector('#setting-extapp-command').value = '  ';
    document.querySelector('#setting-extapp-add').click();
    expect(extApps.list()).toEqual([]);
    expect(document.querySelector('#setting-extapp-msg').textContent).toContain('コマンド');
    expect(rows()).toHaveLength(0);
  });

  it('削除・並べ替えが一覧に反映される', () => {
    const extApps = openWithApps([
      { name: 'A', command: 'a' },
      { name: 'B', command: 'b' },
    ]);
    // B を上へ
    rows()[1].querySelectorAll('button')[0].click();
    expect(extApps.list().map((a) => a.command)).toEqual(['b', 'a']);
    // 先頭（B）を削除
    rows()[0].querySelectorAll('button')[2].click();
    expect(extApps.list().map((a) => a.command)).toEqual(['a']);
    expect(rows()).toHaveLength(1);
  });

  it('端の並べ替えボタンは無効', () => {
    openWithApps([
      { name: 'A', command: 'a' },
      { name: 'B', command: 'b' },
    ]);
    expect(rows()[0].querySelectorAll('button')[0].disabled).toBe(true); // 先頭の ↑
    expect(rows()[1].querySelectorAll('button')[1].disabled).toBe(true); // 末尾の ↓
  });

  it('未登録なら空の案内を出す', () => {
    openWithApps();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('#setting-extapps-list').textContent).toContain('まだ登録');
  });
});
