import { describe, it, expect, beforeEach } from 'vitest';
import {
  TARGET,
  APP_TARGETS,
  NO_WSL,
  normalizeInfo,
  looksLikeWindowsCommand,
  resolveAppTarget,
  resolveDefaultTarget,
  openLabel,
  loadStoredDefaultOpen,
  storeDefaultOpen,
} from '../core/wsl.js';

const WSL = { available: true, distro: 'Ubuntu-22.04' };

describe('normalizeInfo', () => {
  it('Rust の応答を正規化する', () => {
    expect(normalizeInfo({ available: true, distro: 'Ubuntu' })).toEqual({
      available: true,
      distro: 'Ubuntu',
    });
  });

  it('不在・壊れた値は「使えない」に倒す', () => {
    expect(normalizeInfo(null)).toEqual(NO_WSL);
    expect(normalizeInfo(undefined)).toEqual(NO_WSL);
    expect(normalizeInfo('nope')).toEqual(NO_WSL);
    // available が真偽値でない/distro が文字列でない場合も落ちない
    expect(normalizeInfo({ available: 1, distro: 5 })).toEqual({ available: false, distro: '' });
  });
});

describe('looksLikeWindowsCommand', () => {
  it('拡張子とドライブレターで見分ける', () => {
    expect(looksLikeWindowsCommand('notepad.exe')).toBe(true);
    expect(looksLikeWindowsCommand('Code.EXE')).toBe(true);
    expect(looksLikeWindowsCommand('run.bat')).toBe(true);
    expect(looksLikeWindowsCommand('run.cmd')).toBe(true);
    expect(looksLikeWindowsCommand('C:\\Program Files\\7-Zip\\7zFM.exe')).toBe(true);
    expect(looksLikeWindowsCommand('D:/tools/x')).toBe(true);
  });

  it('Linux のコマンドは false', () => {
    expect(looksLikeWindowsCommand('code')).toBe(false);
    expect(looksLikeWindowsCommand('/usr/bin/gimp')).toBe(false);
    expect(looksLikeWindowsCommand('Visual Studio Code')).toBe(false);
    expect(looksLikeWindowsCommand('')).toBe(false);
    expect(looksLikeWindowsCommand(null)).toBe(false);
  });
});

describe('resolveAppTarget', () => {
  it('明示された起動先を優先する', () => {
    expect(resolveAppTarget({ command: 'gimp', target: TARGET.WINDOWS }, WSL)).toBe(TARGET.WINDOWS);
    expect(resolveAppTarget({ command: 'notepad.exe', target: TARGET.LINUX }, WSL)).toBe(
      TARGET.LINUX,
    );
  });

  it('auto はコマンドの見た目で判定する', () => {
    expect(resolveAppTarget({ command: 'notepad.exe', target: TARGET.AUTO }, WSL)).toBe(
      TARGET.WINDOWS,
    );
    expect(resolveAppTarget({ command: 'gimp' }, WSL)).toBe(TARGET.LINUX);
  });

  it('WSL 連携が使えない環境では常に Linux 側（従来経路）', () => {
    expect(resolveAppTarget({ command: 'notepad.exe', target: TARGET.WINDOWS }, NO_WSL)).toBe(
      TARGET.LINUX,
    );
    expect(resolveAppTarget({ command: 'notepad.exe' }, null)).toBe(TARGET.LINUX);
  });
});

describe('resolveDefaultTarget', () => {
  it('WSL では未設定・不正値を Windows 側に倒す', () => {
    expect(resolveDefaultTarget(null, WSL)).toBe(TARGET.WINDOWS);
    expect(resolveDefaultTarget('auto', WSL)).toBe(TARGET.WINDOWS);
    expect(resolveDefaultTarget(TARGET.WINDOWS, WSL)).toBe(TARGET.WINDOWS);
  });

  it('明示的に Linux 側へ戻せる', () => {
    expect(resolveDefaultTarget(TARGET.LINUX, WSL)).toBe(TARGET.LINUX);
  });

  it('非 WSL では設定にかかわらず Linux 側（= その OS の通常経路）', () => {
    expect(resolveDefaultTarget(TARGET.WINDOWS, NO_WSL)).toBe(TARGET.LINUX);
    expect(resolveDefaultTarget(TARGET.WINDOWS, null)).toBe(TARGET.LINUX);
  });
});

describe('openLabel', () => {
  it('WSL ではどちら側かを必ず明示する', () => {
    expect(openLabel('open', TARGET.WINDOWS, true)).toContain('Windows');
    expect(openLabel('open', TARGET.LINUX, true)).toContain('Linux');
    expect(openLabel('reveal', TARGET.WINDOWS, true)).toBe('エクスプローラーで表示');
    expect(openLabel('reveal', TARGET.LINUX, true)).toContain('Linux');
  });

  it('非 WSL では従来のラベルのまま（余計な但し書きを出さない）', () => {
    expect(openLabel('open', TARGET.LINUX, false)).toBe('外部アプリで開く');
    expect(openLabel('reveal', TARGET.LINUX, false)).toBe('ファイルマネージャで表示');
  });
});

describe('既定オープンの永続化', () => {
  beforeEach(() => localStorage.clear());

  it('保存して読み戻せる', () => {
    expect(storeDefaultOpen(TARGET.LINUX)).toBe(true);
    expect(loadStoredDefaultOpen()).toBe(TARGET.LINUX);
    expect(storeDefaultOpen(TARGET.WINDOWS)).toBe(true);
    expect(loadStoredDefaultOpen()).toBe(TARGET.WINDOWS);
  });

  it('未設定は null（呼び出し側で既定に倒す）', () => {
    expect(loadStoredDefaultOpen()).toBeNull();
  });

  it('不正値は保存も復元もしない', () => {
    expect(storeDefaultOpen('mac')).toBe(false);
    expect(storeDefaultOpen(TARGET.AUTO)).toBe(false);
    expect(loadStoredDefaultOpen()).toBeNull();
    localStorage.setItem('tana.wsl.defaultopen', 'oops');
    expect(loadStoredDefaultOpen()).toBeNull();
  });
});

describe('APP_TARGETS', () => {
  it('設定 UI の選択肢は auto/linux/windows の 3 つ', () => {
    expect(APP_TARGETS).toEqual([TARGET.AUTO, TARGET.LINUX, TARGET.WINDOWS]);
  });
});
