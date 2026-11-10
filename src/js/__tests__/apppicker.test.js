import { describe, it, expect, afterEach } from 'vitest';
import { filterApps, sideLabel, clampIndex, showAppPicker, MAX_ROWS } from '../core/apppicker.js';

const APPS = [
  { name: '7-Zip 23.01 (x64)', command: 'C:\\Program Files\\7-Zip\\7zFM.exe', target: 'windows' },
  {
    name: 'VLC media player',
    command: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    target: 'windows',
  },
  { name: 'GIMP', command: 'gimp', target: 'linux' },
];

const flush = () => new Promise((r) => setTimeout(r, 0));
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('filterApps', () => {
  it('空の問い合わせは全件（元の配列は壊さない）', () => {
    const got = filterApps(APPS, '  ');
    expect(got).toEqual(APPS);
    expect(got).not.toBe(APPS);
  });
  it('表示名とコマンドの両方を大文字小文字を無視して見る', () => {
    expect(filterApps(APPS, '7-zip').map((a) => a.name)).toEqual(['7-Zip 23.01 (x64)']);
    expect(filterApps(APPS, '7ZFM').map((a) => a.name)).toEqual(['7-Zip 23.01 (x64)']);
    expect(filterApps(APPS, 'videolan')).toHaveLength(1);
  });
  it('空白区切りの語はすべて含むものだけ（AND）', () => {
    expect(filterApps(APPS, 'program vlc').map((a) => a.name)).toEqual(['VLC media player']);
    expect(filterApps(APPS, 'gimp program')).toEqual([]);
  });
  it('不正な入力でも落ちない', () => {
    expect(filterApps(null, 'x')).toEqual([]);
    expect(filterApps([{}], '')).toEqual([{}]);
    expect(filterApps([{}], 'x')).toEqual([]);
  });
});

describe('sideLabel / clampIndex', () => {
  it('WSL のときだけ Windows / Linux を添える', () => {
    expect(sideLabel(APPS[0], true)).toBe('Windows');
    expect(sideLabel(APPS[2], true)).toBe('Linux');
    expect(sideLabel({ target: 'auto' }, true)).toBe('');
    expect(sideLabel(APPS[0], false)).toBe('');
  });
  it('選択位置は範囲内に収める', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(0, 0)).toBe(-1);
  });
});

describe('showAppPicker', () => {
  it('読み込み後に一覧を出し、入力で絞り込み、Enter で先頭を選ぶ', async () => {
    const p = showAppPicker({ load: async () => APPS, wsl: true });
    expect(document.querySelector('.app-picker-status').textContent).toContain('読み込んで');
    await flush();
    const input = document.querySelector('.app-picker-filter');
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll('.app-picker-row')).toHaveLength(3);
    expect(document.querySelector('.app-picker-side').textContent).toBe('Windows');
    input.value = 'vlc';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.app-picker-row')).toHaveLength(1);
    key(input, 'Enter');
    expect(await p).toBe(APPS[1]);
    expect(document.querySelector('.app-picker')).toBeNull();
  });

  it('↑↓ で選択を動かし、端で止まる', async () => {
    const p = showAppPicker({ load: async () => APPS });
    await flush();
    const input = document.querySelector('.app-picker-filter');
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'ArrowDown'); // 末尾で止まる
    const rows = document.querySelectorAll('.app-picker-row');
    expect(rows[2].classList.contains('is-selected')).toBe(true);
    expect(rows[2].getAttribute('aria-selected')).toBe('true');
    key(input, 'ArrowUp');
    key(input, 'Enter');
    expect(await p).toBe(APPS[1]);
  });

  it('一致が無いときの Enter は何もしない。Esc で null', async () => {
    const p = showAppPicker({ load: async () => APPS });
    await flush();
    const input = document.querySelector('.app-picker-filter');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.app-picker-status').textContent).toContain('一致する');
    key(input, 'Enter');
    expect(document.querySelector('.app-picker')).toBeTruthy();
    key(input, 'Escape');
    expect(await p).toBeNull();
  });

  it('背景クリック / キャンセルで null', async () => {
    let p = showAppPicker({ load: async () => APPS });
    await flush();
    document.querySelector('.app-picker-overlay').click();
    expect(await p).toBeNull();
    p = showAppPicker({ load: async () => APPS });
    await flush();
    document.querySelector('.app-picker .modal-btn').click();
    expect(await p).toBeNull();
  });

  it('取得に失敗したら理由を出す（閉じない）', async () => {
    const p = showAppPicker({
      load: async () => {
        throw new Error('powershell.exe を起動できませんでした');
      },
    });
    await flush();
    expect(document.querySelector('.app-picker-status').textContent).toContain('powershell.exe');
    key(document.querySelector('.app-picker-filter'), 'Escape');
    expect(await p).toBeNull();
  });

  it('空の一覧ならその旨を出す', async () => {
    const p = showAppPicker({ load: async () => [] });
    await flush();
    expect(document.querySelector('.app-picker-status').textContent).toContain('見つかりません');
    key(document.querySelector('.app-picker-filter'), 'Escape');
    await p;
  });

  it(`描く行は ${MAX_ROWS} 件までで、残りは絞り込みを促す`, async () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({
      name: `app${i}`,
      command: `a${i}`,
    }));
    const p = showAppPicker({ load: async () => many });
    await flush();
    expect(document.querySelectorAll('.app-picker-row')).toHaveLength(MAX_ROWS);
    expect(document.querySelector('.app-picker-status').textContent).toContain(
      `${MAX_ROWS + 5} 件中`,
    );
    key(document.querySelector('.app-picker-filter'), 'Escape');
    await p;
  });

  it('閉じた後に読み込みが終わっても何も描かない', async () => {
    let release;
    const p = showAppPicker({ load: () => new Promise((r) => (release = r)) });
    key(document.querySelector('.app-picker-filter'), 'Escape');
    expect(await p).toBeNull();
    release(APPS);
    await flush();
    expect(document.querySelector('.app-picker-row')).toBeNull();
  });

  it('document が無ければ null', async () => {
    expect(await showAppPicker({ load: async () => APPS, doc: {} })).toBeNull();
  });
});
