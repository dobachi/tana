import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { describeManualCheck, checkForUpdates } from '../core/updater.js';

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

let mockUpdate = null;
let mockRelaunch = vi.fn();

describe('更新ダイアログ', () => {
  beforeEach(() => {
    // isDesktop() が真になるよう最小の Tauri グローバルを置く
    window.__TAURI__ = { core: { invoke: vi.fn() } };
    mockRelaunch = vi.fn();
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

  it('インストールに失敗したらダイアログを閉じ、再起動しない', async () => {
    mockUpdate.downloadAndInstall = vi.fn().mockRejectedValue(new Error('disk full'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await checkForUpdates();
    document.querySelector('.btn-update').click();
    await vi.waitFor(() => expect(document.querySelector('.modal-overlay')).toBeNull());
    expect(mockRelaunch).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
