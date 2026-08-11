import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  describeManualCheck,
  describeInstallPlan,
  describeInstallError,
  isLinuxPlatform,
  checkForUpdates,
} from '../core/updater.js';

describe('describeManualCheck', () => {
  it('ブラウザ単体ではデスクトップ版限定である旨を返す', () => {
    const r = describeManualCheck({ isDesktop: false, update: null, error: null });
    expect(r.kind).toBe('unsupported');
    expect(r.type).toBe('error');
    expect(r.message).toContain('デスクトップ版');
  });

  it('非デスクトップの判定はエラーより優先される', () => {
    const r = describeManualCheck({ isDesktop: false, update: null, error: 'boom' });
    expect(r.kind).toBe('unsupported');
  });

  it('エラー時はメッセージを埋め込んで返す', () => {
    const r = describeManualCheck({ isDesktop: true, update: null, error: 'network down' });
    expect(r.kind).toBe('error');
    expect(r.type).toBe('error');
    expect(r.message).toContain('network down');
  });

  it('更新がある場合はバージョンを返す', () => {
    const r = describeManualCheck({ isDesktop: true, update: { version: '0.2.0' }, error: null });
    expect(r).toEqual({ kind: 'update', version: '0.2.0' });
  });

  it('更新もエラーも無ければ最新である旨を返す', () => {
    const r = describeManualCheck({ isDesktop: true, update: null, error: null });
    expect(r.kind).toBe('latest');
    expect(r.type).toBe('info');
    expect(r.message).toContain('最新');
  });

  it('現在バージョンがあれば最新メッセージに含める', () => {
    const r = describeManualCheck({
      isDesktop: true,
      update: null,
      error: null,
      currentVersion: '0.4.1',
    });
    expect(r.kind).toBe('latest');
    expect(r.message).toContain('v0.4.1');
  });
});

describe('describeInstallPlan', () => {
  it('判定できない（Tauri 不在）ならアプリ内更新のまま', () => {
    expect(describeInstallPlan(null).mode).toBe('in-app');
    expect(describeInstallPlan().label).toBe('アップデート');
    expect(describeInstallPlan(null).note).toBe('');
  });

  it('アプリ内更新が可能なら従来どおり', () => {
    const plan = describeInstallPlan({ needs_root: true, no_auth: false, can_install: true });
    expect(plan.mode).toBe('in-app');
  });

  // WSL の deb 版ではパスワードをコンソールと GUI で 2 度聞かれた末に必ず失敗する。
  // 試させないことが目的なので、ボタン自体を手動更新に差し替える。
  it('アプリ内更新が不可能なら手動更新へ誘導する', () => {
    const plan = describeInstallPlan({ needs_root: true, no_auth: true, can_install: false });
    expect(plan.mode).toBe('manual');
    expect(plan.label).toContain('リリースページ');
    expect(plan.note).toContain('管理者権限');
  });
});

describe('describeInstallError', () => {
  it('エラーメッセージをそのまま詳細として返す', () => {
    expect(describeInstallError(new Error('exit code 127')).detail).toBe('exit code 127');
  });

  it('message を持たない値も文字列化する', () => {
    expect(describeInstallError('boom').detail).toBe('boom');
    expect(describeInstallError(null).detail).toBe('不明なエラー');
    expect(describeInstallError(undefined).detail).toBe('不明なエラー');
  });

  it('Linux では管理者権限と手動更新に触れる', () => {
    const r = describeInstallError(new Error('x'), { isLinux: true });
    expect(r.hint).toContain('管理者権限');
    expect(r.hint).toContain('手動');
  });

  it('Linux 以外では再試行を案内する', () => {
    expect(describeInstallError(new Error('x'), { isLinux: false }).hint).toContain('再試行');
    expect(describeInstallError(new Error('x')).hint).toContain('再試行');
  });
});

describe('isLinuxPlatform', () => {
  it('Linux を判定する', () => {
    expect(isLinuxPlatform({ platform: 'Linux x86_64', userAgent: 'X11; Linux' })).toBe(true);
  });

  it('Android は Linux 扱いしない', () => {
    expect(isLinuxPlatform({ platform: 'Linux armv8l', userAgent: 'Android 14' })).toBe(false);
  });

  it('Windows / macOS は false', () => {
    expect(isLinuxPlatform({ platform: 'Win32', userAgent: 'Windows NT' })).toBe(false);
    expect(isLinuxPlatform({ platform: 'MacIntel', userAgent: 'Macintosh' })).toBe(false);
  });

  it('navigator が無くても落ちない', () => {
    expect(isLinuxPlatform(null)).toBe(false);
  });
});

describe('checkForUpdates（ブラウザ単体）', () => {
  afterEach(() => {
    delete window.__TAURI__;
    document.body.innerHTML = '';
  });

  it('起動時チェックは何も通知しない', async () => {
    const notify = vi.fn();
    await checkForUpdates({ notify });
    expect(notify).not.toHaveBeenCalled();
  });

  it('手動チェックはデスクトップ版限定である旨を通知する', async () => {
    const notify = vi.fn();
    await checkForUpdates({ manual: true, notify });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain('デスクトップ版');
  });

  it('notify 未指定でも例外にならない', async () => {
    await expect(checkForUpdates({ manual: true })).resolves.toBeUndefined();
  });

  it('Tauri 不在ならプラグインを読みに行かない（ダイアログも出ない）', async () => {
    await checkForUpdates({ manual: true, notify: vi.fn() });
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });
});

// showUpdateDialog は checkForUpdates 経由でしか呼べないため、Tauri ランタイムを
// 偽装して更新ありの経路を通す。プラグインの動的 import は vi.mock で差し替える。
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => Promise.resolve(mockUpdate) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => Promise.resolve(mockRelaunch()) }));
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (url) => Promise.resolve(mockOpenUrl(url)),
}));

let mockUpdate = null;
let mockRelaunch = vi.fn();
let mockOpenUrl = vi.fn();
/** update_env コマンドの戻り値。null = 判定不能（従来どおりアプリ内更新） */
let mockEnv = null;

describe('更新ダイアログ', () => {
  beforeEach(() => {
    // isDesktop() が真になるよう最小の Tauri グローバルを置く
    mockEnv = null;
    window.__TAURI__ = {
      core: { invoke: vi.fn(async (cmd) => (cmd === 'update_env' ? mockEnv : null)) },
    };
    mockRelaunch = vi.fn();
    mockOpenUrl = vi.fn();
    mockUpdate = {
      version: '0.2.0',
      body: 'リリースノート本文',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    delete window.__TAURI__;
    document.body.innerHTML = '';
  });

  it('更新があればアプリ既存のモーダル規約でダイアログを出す', async () => {
    await checkForUpdates();
    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.querySelector('.modal-msg').textContent).toContain('0.2.0');
    expect(overlay.querySelector('.modal-label').textContent).toContain('リリースノート本文');
  });

  it('更新がある場合は manual でもトーストを出さずダイアログを優先する', async () => {
    const notify = vi.fn();
    await checkForUpdates({ manual: true, notify });
    expect(notify).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-overlay')).toBeTruthy();
  });

  it('スキップでダイアログを閉じ、インストールしない', async () => {
    await checkForUpdates();
    document.querySelector('.btn-skip').click();
    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(mockUpdate.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('アップデートでインストールし再起動する', async () => {
    await checkForUpdates();
    document.querySelector('.btn-update').click();
    await vi.waitFor(() => expect(mockRelaunch).toHaveBeenCalled());
    expect(mockUpdate.downloadAndInstall).toHaveBeenCalled();
  });

  it('インストール中は両ボタンを無効化する', async () => {
    let resolveInstall;
    mockUpdate.downloadAndInstall = vi.fn(() => new Promise((r) => (resolveInstall = r)));
    await checkForUpdates();
    document.querySelector('.btn-update').click();
    await vi.waitFor(() => expect(document.querySelector('.btn-update').disabled).toBe(true));
    expect(document.querySelector('.btn-skip').disabled).toBe(true);
    expect(document.querySelector('.btn-update').textContent).toContain('ダウンロード');
    resolveInstall();
  });

  it('インストールに失敗したら理由を出したまま閉じず、再起動しない', async () => {
    mockUpdate.downloadAndInstall = vi.fn().mockRejectedValue(new Error('disk full'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await checkForUpdates();
    document.querySelector('.btn-update').click();
    await vi.waitFor(() => expect(document.querySelector('.update-error-detail')).toBeTruthy());
    expect(document.querySelector('.update-error-detail').textContent).toContain('disk full');
    expect(document.querySelector('.update-error-hint').textContent).toBeTruthy();
    expect(mockRelaunch).not.toHaveBeenCalled();
    document.querySelector('.btn-close').click();
    expect(document.querySelector('.modal-overlay')).toBeNull();
    err.mockRestore();
  });

  it('失敗ダイアログからリリースページを開ける', async () => {
    mockUpdate.downloadAndInstall = vi.fn().mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await checkForUpdates();
    document.querySelector('.btn-update').click();
    await vi.waitFor(() => expect(document.querySelector('.btn-release')).toBeTruthy());
    document.querySelector('.btn-release').click();
    await vi.waitFor(() => expect(mockOpenUrl).toHaveBeenCalled());
    expect(mockOpenUrl.mock.calls[0][0]).toContain('/releases');
    err.mockRestore();
  });

  it('エラーメッセージの markup をエスケープする', async () => {
    mockUpdate.downloadAndInstall = vi.fn().mockRejectedValue(new Error('<img src=x>'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await checkForUpdates();
    document.querySelector('.btn-update').click();
    await vi.waitFor(() => expect(document.querySelector('.update-error-detail')).toBeTruthy());
    expect(document.querySelector('.update-error-detail').querySelector('img')).toBeNull();
    err.mockRestore();
  });
});

// WSL の deb 版では pkexec（コンソール）と zenity（GUI）の両方でパスワードを聞かれた
// 末に必ず失敗する。そもそもインストールを走らせないことが修正の要点。
describe('更新ダイアログ（アプリ内更新が不可能な環境）', () => {
  beforeEach(() => {
    mockEnv = { needs_root: true, no_auth: true, can_install: false };
    window.__TAURI__ = {
      core: { invoke: vi.fn(async (cmd) => (cmd === 'update_env' ? mockEnv : null)) },
    };
    mockRelaunch = vi.fn();
    mockOpenUrl = vi.fn();
    mockUpdate = {
      version: '0.2.0',
      body: 'リリースノート本文',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    delete window.__TAURI__;
    document.body.innerHTML = '';
  });

  it('理由を添えて手動更新のボタンに差し替える', async () => {
    await checkForUpdates();
    expect(document.querySelector('.btn-update').textContent).toContain('リリースページ');
    expect(document.querySelector('.update-note').textContent).toContain('管理者権限');
  });

  it('押してもインストールは走らせず、リリースページを開く', async () => {
    await checkForUpdates();
    document.querySelector('.btn-update').click();
    await vi.waitFor(() => expect(mockOpenUrl).toHaveBeenCalled());
    expect(mockUpdate.downloadAndInstall).not.toHaveBeenCalled();
    expect(mockRelaunch).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });
});
