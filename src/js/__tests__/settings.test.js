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

describe('一覧の小さな写真', () => {
  it('現在値がチェックに出て、変えると setThumbnails に伝わる', () => {
    const setThumbnails = vi.fn();
    openSettings({ ...deps, getThumbnails: () => true, setThumbnails });
    const cb = document.querySelector('#setting-thumbnails');
    expect(cb.checked).toBe(true);
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(setThumbnails).toHaveBeenCalledWith(false);
  });

  it('オフの現在値も出る', () => {
    openSettings({ ...deps, getThumbnails: () => false, setThumbnails: vi.fn() });
    expect(document.querySelector('#setting-thumbnails').checked).toBe(false);
  });

  it('setThumbnails を渡さなければ項目を出さない', () => {
    openSettings(deps);
    expect(document.querySelector('#setting-thumbnails')).toBeNull();
  });
});

describe('キーガイド', () => {
  it('現在値がチェックに出て、変えると setKeyGuide に伝わる', () => {
    const setKeyGuide = vi.fn();
    openSettings({ ...deps, getKeyGuide: () => false, setKeyGuide });
    const cb = document.querySelector('#setting-keyguide');
    expect(cb.checked).toBe(false);
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(setKeyGuide).toHaveBeenCalledWith(true);
  });

  it('オンの現在値も出る', () => {
    openSettings({ ...deps, getKeyGuide: () => true, setKeyGuide: vi.fn() });
    expect(document.querySelector('#setting-keyguide').checked).toBe(true);
  });

  it('setKeyGuide を渡さなければ項目を出さない', () => {
    openSettings(deps);
    expect(document.querySelector('#setting-keyguide')).toBeNull();
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

describe('外部アプリ: 一覧から選ぶ / 参照', () => {
  const rows = () => document.querySelectorAll('.extapp-row');
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const SEVEN_ZIP = {
    name: '7-Zip 23.01 (x64)',
    command: 'C:\\Program Files\\7-Zip\\7zFM.exe',
    target: 'windows',
  };

  it('取得手段が渡されなければボタンを出さない', () => {
    openSettings({ ...deps, extApps: createExtApps() });
    expect(document.querySelector('#setting-extapp-pick').hidden).toBe(true);
    expect(document.querySelector('#setting-extapp-browse').hidden).toBe(true);
  });

  it('一覧から選ぶとそのまま登録される（起動先も引き継ぐ）', async () => {
    const extApps = createExtApps();
    const listInstalledApps = vi.fn(async () => [SEVEN_ZIP, { name: 'VLC', command: 'vlc' }]);
    openSettings({ ...deps, extApps, listInstalledApps, wsl: { available: true } });
    document.querySelector('#setting-extapp-pick').click();
    await flush();
    const picker = document.querySelector('.app-picker');
    expect(picker).toBeTruthy();
    expect(picker.querySelectorAll('.app-picker-row')).toHaveLength(2);
    picker.querySelector('.app-picker-row').click();
    await flush();
    expect(document.querySelector('.app-picker')).toBeNull();
    expect(extApps.list()).toHaveLength(1);
    expect(extApps.list()[0]).toMatchObject({
      name: SEVEN_ZIP.name,
      command: SEVEN_ZIP.command,
      target: 'windows',
    });
    expect(rows()).toHaveLength(1);
    expect(document.querySelector('#setting-extapp-msg').textContent).toContain('追加しました');
  });

  it('同じアプリを二度選ぶと理由を出し、重複登録しない', async () => {
    const extApps = createExtApps([SEVEN_ZIP]);
    openSettings({ ...deps, extApps, listInstalledApps: async () => [SEVEN_ZIP] });
    document.querySelector('#setting-extapp-pick').click();
    await flush();
    document.querySelector('.app-picker-row').click();
    await flush();
    expect(extApps.list()).toHaveLength(1);
    expect(document.querySelector('#setting-extapp-msg').textContent).toContain('すでに');
  });

  it('選択画面を Esc で閉じても設定画面は閉じず、何も登録しない', async () => {
    const extApps = createExtApps();
    openSettings({ ...deps, extApps, listInstalledApps: async () => [SEVEN_ZIP] });
    document.querySelector('#setting-extapp-pick').click();
    await flush();
    document
      .querySelector('.app-picker-filter')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(document.querySelector('.app-picker')).toBeNull();
    expect(isSettingsOpen()).toBe(true);
    expect(extApps.list()).toHaveLength(0);
  });

  it('参照…で選んだパスがコマンド欄に入り、表示名が空なら補う', async () => {
    const extApps = createExtApps();
    const pickProgramFile = vi.fn(async () => '/mnt/c/Program Files/7-Zip/7zFM.exe');
    openSettings({ ...deps, extApps, pickProgramFile });
    document.querySelector('#setting-extapp-browse').click();
    await flush();
    expect(document.querySelector('#setting-extapp-command').value).toBe(
      '/mnt/c/Program Files/7-Zip/7zFM.exe',
    );
    expect(document.querySelector('#setting-extapp-name').value).toBe('7zFM');
    // 登録は「追加」を押してから（参照だけでは増えない）
    expect(extApps.list()).toHaveLength(0);
  });

  it('参照…で表示名が入力済みなら上書きしない / キャンセルなら何もしない', async () => {
    const extApps = createExtApps();
    const results = ['C:\\x\\a.exe', null];
    openSettings({ ...deps, extApps, pickProgramFile: async () => results.shift() });
    const nameEl = document.querySelector('#setting-extapp-name');
    const cmdEl = document.querySelector('#setting-extapp-command');
    nameEl.value = '自分の名前';
    document.querySelector('#setting-extapp-browse').click();
    await flush();
    expect(nameEl.value).toBe('自分の名前');
    expect(cmdEl.value).toBe('C:\\x\\a.exe');
    document.querySelector('#setting-extapp-browse').click();
    await flush();
    expect(cmdEl.value).toBe('C:\\x\\a.exe');
  });
});

// --- WSL 連携（FR-13 の WSL 拡張） ---
describe('WSL セクション', () => {
  const rows = () => document.querySelectorAll('.extapp-row');
  const WSL = { available: true, distro: 'Ubuntu-22.04' };

  it('WSL でなければ WSL 用の UI は一切出ない', () => {
    openSettings({ ...deps, extApps: createExtApps([{ name: 'A', command: 'a' }]) });
    expect(document.querySelector('#setting-wsl-group')).toBeNull();
    expect(document.querySelector('#setting-extapp-target')).toBeNull();
    expect(rows()[0].querySelector('.extapp-target')).toBeNull();
  });

  it('WSL では既定オープンの行き先を選べ、現在値が入る', () => {
    const setDefaultOpen = vi.fn();
    openSettings({
      ...deps,
      wsl: WSL,
      getDefaultOpen: () => 'linux',
      setDefaultOpen,
    });
    const sel = document.querySelector('#setting-wsl-default');
    expect(sel).toBeTruthy();
    expect(sel.value).toBe('linux');
    expect(document.querySelector('#setting-wsl-group').textContent).toContain('Ubuntu-22.04');

    sel.value = 'windows';
    sel.dispatchEvent(new Event('change'));
    expect(setDefaultOpen).toHaveBeenCalledWith('windows');
  });

  it('WSL では各アプリに起動先の選択が付き、変更が反映される', () => {
    const extApps = createExtApps([{ name: 'メモ帳', command: 'notepad.exe' }]);
    openSettings({ ...deps, extApps, wsl: WSL });
    const sel = rows()[0].querySelector('.extapp-target');
    expect(sel).toBeTruthy();
    expect(sel.value).toBe('auto'); // 既定は自動判定

    sel.value = 'windows';
    sel.dispatchEvent(new Event('change'));
    expect(extApps.list()[0].target).toBe('windows');
  });

  it('WSL では起動先を指定して追加できる', () => {
    const extApps = createExtApps();
    openSettings({ ...deps, extApps, wsl: WSL });
    document.querySelector('#setting-extapp-command').value = 'gimp';
    document.querySelector('#setting-extapp-target').value = 'linux';
    document.querySelector('#setting-extapp-add').click();
    expect(extApps.list()[0].target).toBe('linux');
    // 追加後は「自動」に戻る（前の指定が次の登録へ漏れない）
    expect(document.querySelector('#setting-extapp-target').value).toBe('auto');
  });

  it('available:false の WSL 情報は「WSL でない」と同じ扱い', () => {
    openSettings({ ...deps, extApps: createExtApps(), wsl: { available: false, distro: '' } });
    expect(document.querySelector('#setting-wsl-group')).toBeNull();
  });
});

describe('拡張機能: PDF プレビュー', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function makeExt({ installed = false, installError = null } = {}) {
    const state = { enabled: false, installed };
    return {
      state,
      getEnabled: () => state.enabled,
      setEnabled: vi.fn((v) => {
        state.enabled = v;
      }),
      status: vi.fn(async () =>
        state.installed ? { installed: true, version: '4.10.38' } : { installed: false },
      ),
      install: vi.fn(async (onProgress) => {
        onProgress(1048576, 2 * 1048576);
        if (installError) throw new Error(installError);
        state.installed = true;
      }),
      uninstall: vi.fn(async () => {
        state.installed = false;
      }),
    };
  }

  const q = (sel) => document.querySelector(sel);

  it('pdfExt が無ければ欄ごと隠す', () => {
    openSettings(deps);
    expect(q('#setting-extensions-group').style.display).toBe('none');
  });

  it('導入状態を出す。未導入なら削除ボタンは無い', async () => {
    openSettings({ ...deps, pdfExt: makeExt() });
    await flush();
    expect(q('#setting-pdf').checked).toBe(false);
    expect(q('#setting-pdf-status').textContent).toBe('未導入');
    expect(q('#setting-pdf-remove').hidden).toBe(true);
  });

  it('チェックで未導入ならダウンロードしてから有効にする', async () => {
    const ext = makeExt();
    openSettings({ ...deps, pdfExt: ext });
    await flush();
    const box = q('#setting-pdf');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    expect(ext.install).toHaveBeenCalledTimes(1);
    expect(ext.setEnabled).toHaveBeenLastCalledWith(true);
    expect(q('#setting-pdf-status').textContent).toBe('導入済み（4.10.38）');
    expect(q('#setting-pdf-remove').hidden).toBe(false);
    expect(q('#setting-pdf-progress').hidden).toBe(true);
    expect(box.disabled).toBe(false);
  });

  it('導入済みならダウンロードせずに有効にする', async () => {
    const ext = makeExt({ installed: true });
    openSettings({ ...deps, pdfExt: ext });
    await flush();
    const box = q('#setting-pdf');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(ext.install).not.toHaveBeenCalled();
    expect(ext.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it('ダウンロードに失敗したらチェックを戻し、理由を出す', async () => {
    const ext = makeExt({ installError: 'SHA-256 が一致しません' });
    openSettings({ ...deps, pdfExt: ext });
    await flush();
    const box = q('#setting-pdf');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    expect(box.checked).toBe(false);
    expect(ext.state.enabled).toBe(false);
    expect(q('#setting-pdf-status').textContent).toMatch(/失敗しました: SHA-256/);
  });

  it('チェックを外すと無効にするだけ。削除ボタンで消す', async () => {
    const ext = makeExt({ installed: true });
    ext.state.enabled = true;
    openSettings({ ...deps, pdfExt: ext });
    await flush();
    const box = q('#setting-pdf');
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(ext.setEnabled).toHaveBeenLastCalledWith(false);
    expect(ext.uninstall).not.toHaveBeenCalled();
    q('#setting-pdf-remove').click();
    await flush();
    await flush();
    expect(ext.uninstall).toHaveBeenCalledTimes(1);
    expect(q('#setting-pdf-status').textContent).toBe('未導入');
  });
});
