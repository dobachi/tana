import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  prepareDragOut,
  primaryButtonDown,
  takeCrashNotice,
  crashLogLocation,
} from '../backend.js';

function withInvoke(impl) {
  const invoke = vi.fn(impl);
  window.__TAURI__ = { core: { invoke } };
  return invoke;
}

afterEach(() => {
  delete window.__TAURI__;
});

describe('外へのドラッグの点検（dragout.rs）', () => {
  it('Tauri が無ければパスをそのまま返す', async () => {
    expect(await prepareDragOut(['/a.txt'])).toEqual(['/a.txt']);
  });

  it('prepare_drag_out に渡し、置き直したパスを返す', async () => {
    const invoke = withInvoke(async () => ['C:\\tmp\\tana-drag\\1\\a.txt']);
    expect(await prepareDragOut(['C:\\very\\long\\a.txt'])).toEqual([
      'C:\\tmp\\tana-drag\\1\\a.txt',
    ]);
    expect(invoke).toHaveBeenCalledWith('prepare_drag_out', { paths: ['C:\\very\\long\\a.txt'] });
  });

  it('断られたら reject を伝える（呼び出し側がトーストにする）', async () => {
    withInvoke(async () => {
      throw 'パスが長すぎる';
    });
    await expect(prepareDragOut(['/a'])).rejects.toBe('パスが長すぎる');
  });
});

describe('primaryButtonDown', () => {
  it('OS の答えを返す', async () => {
    withInvoke(async () => true);
    expect(await primaryButtonDown()).toBe(true);
    withInvoke(async () => false);
    expect(await primaryButtonDown()).toBe(false);
  });

  it('分からない（Windows 以外・Tauri 無し・失敗）は null', async () => {
    expect(await primaryButtonDown()).toBeNull();
    withInvoke(async () => null);
    expect(await primaryButtonDown()).toBeNull();
    withInvoke(async () => {
      throw new Error('x');
    });
    expect(await primaryButtonDown()).toBeNull();
  });
});

describe('takeCrashNotice', () => {
  it('記録があればパス、無ければ null。失敗しても投げない', async () => {
    withInvoke(async () => 'C:\\Users\\u\\AppData\\Local\\com.dobachi.tana\\crash.log');
    expect(await takeCrashNotice()).toContain('crash.log');
    withInvoke(async () => null);
    expect(await takeCrashNotice()).toBeNull();
    withInvoke(async () => {
      throw new Error('x');
    });
    expect(await takeCrashNotice()).toBeNull();
  });
});

describe('crashLogLocation', () => {
  it('crash_log_location の答えを返す。Tauri が無ければ null', async () => {
    expect(await crashLogLocation()).toBeNull();
    const invoke = withInvoke(async () => '/home/u/.local/share/com.dobachi.tana');
    expect(await crashLogLocation()).toBe('/home/u/.local/share/com.dobachi.tana');
    expect(invoke).toHaveBeenCalledWith('crash_log_location', {});
  });

  it('失敗は呼び出し側へ伝える（トーストで理由を出すため）', async () => {
    withInvoke(async () => {
      throw 'denied';
    });
    await expect(crashLogLocation()).rejects.toBe('denied');
  });
});
