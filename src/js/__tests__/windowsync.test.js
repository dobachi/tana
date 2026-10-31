import { describe, it, expect, vi } from 'vitest';
import { createStorageSync, startupPlan } from '../core/windowsync.js';
import { createFavorites } from '../core/favorites.js';
import { createFavViewState } from '../core/favarrange.js';
import { createWorkspaces } from '../core/workspaces.js';
import { createExtApps } from '../core/extapps.js';
import { createRemotes } from '../core/remotes.js';

describe('createStorageSync', () => {
  it('キーに応じて JSON を解いた値を渡す', () => {
    const fav = vi.fn();
    const sync = createStorageSync({ 'tana.favorites': fav });
    expect(sync({ key: 'tana.favorites', newValue: '[{"name":"a","path":"/a"}]' })).toBe(true);
    expect(fav).toHaveBeenCalledWith([{ name: 'a', path: '/a' }]);
  });

  it('JSON でない値（テーマ名）はそのまま、消されたら null', () => {
    const theme = vi.fn();
    const sync = createStorageSync({ 'tana.theme': theme });
    sync({ key: 'tana.theme', newValue: 'light' });
    sync({ key: 'tana.theme', newValue: null });
    expect(theme.mock.calls).toEqual([['light'], [null]]);
  });

  it('知らないキー・clear()（key が null）・別の保存領域は無視', () => {
    const fn = vi.fn();
    const mine = {};
    const sync = createStorageSync({ k: fn }, { storage: mine });
    expect(sync({ key: 'other', newValue: '1' })).toBe(false);
    expect(sync({ key: null, newValue: null })).toBe(false);
    expect(sync({ key: 'k', newValue: '1', storageArea: {} })).toBe(false);
    expect(sync(null)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(sync({ key: 'k', newValue: '1', storageArea: mine })).toBe(true);
  });

  it('取り込み側が投げても落ちない', () => {
    const sync = createStorageSync({
      k: () => {
        throw new Error('x');
      },
    });
    expect(sync({ key: 'k', newValue: '1' })).toBe(false);
  });
});

describe('startupPlan', () => {
  it('最初のウィンドウ: 引数が無ければセッション、あれば引数の場所。どちらも保存・更新確認をする', () => {
    expect(startupPlan({ isMain: true })).toEqual({
      startPath: null,
      useSession: true,
      saveSession: true,
      checkUpdates: true,
    });
    expect(startupPlan({ isMain: true, cliPath: '/w' })).toMatchObject({
      startPath: '/w',
      useSession: false,
      saveSession: true,
    });
  });

  it('追加ウィンドウ: 渡された場所（無ければホーム）。セッションも更新確認も触らない', () => {
    expect(startupPlan({ isMain: false, openRequest: 'sftp://h/x', cliPath: '/w' })).toEqual({
      startPath: 'sftp://h/x',
      useSession: false,
      saveSession: false,
      checkUpdates: false,
    });
    expect(startupPlan({ isMain: false }).startPath).toBe('');
  });
});

/** 2 つのウィンドウが同じ保存先を持つ状況を真似る: A の変更を B が取り込む */
describe('別ウィンドウの変更の取り込み（replace）', () => {
  it('お気に入り: 取り込むと通知し、同じ内容なら通知しない（書き合いにならない）', () => {
    const a = createFavorites([{ name: 'x', path: '/x' }]);
    const b = createFavorites([{ name: 'x', path: '/x' }]);
    a.addBookmark('y', '/y');
    const seen = vi.fn();
    b.subscribe(seen);
    seen.mockClear();
    b.replace(JSON.parse(JSON.stringify(a.toJSON())));
    expect(b.toJSON()).toEqual(a.toJSON());
    expect(seen).toHaveBeenCalledTimes(1);
    b.replace(JSON.parse(JSON.stringify(a.toJSON())));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('お気に入りの見せ方', () => {
    const a = createFavViewState();
    const b = createFavViewState();
    a.update({ group: 'host' });
    const seen = vi.fn();
    b.subscribe(seen);
    b.replace(a.toJSON());
    expect(b.toJSON()).toEqual(a.toJSON());
    b.replace(a.toJSON());
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('ワークスペース: 相手の id のまま取り込み、その後の保存も重ならない', () => {
    const a = createWorkspaces([]);
    a.save('w1', { left: ['/a'] });
    a.save('w2', { right: ['/b'] });
    const b = createWorkspaces([]);
    const seen = vi.fn();
    b.subscribe(seen);
    b.replace(a.toJSON());
    expect(b.toJSON()).toEqual(a.toJSON());
    b.replace(a.toJSON());
    expect(seen).toHaveBeenCalledTimes(1);
    const id = b.save('w3', { left: ['/c'] });
    expect(a.toJSON().map((w) => w.id)).not.toContain(id);
  });

  it('外部アプリ', () => {
    const a = createExtApps([]);
    a.add({ name: 'VS Code', command: 'code' });
    const b = createExtApps([]);
    const seen = vi.fn();
    b.subscribe(seen);
    b.replace(a.serialize());
    expect(b.serialize()).toEqual(a.serialize());
    b.replace(a.serialize());
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('リモート: 最近の接続先は取り込み、書き込み許可はそのウィンドウのまま', () => {
    const a = createRemotes();
    const b = createRemotes();
    b.setWritable('k16', true);
    a.touch('k16', '/srv');
    b.replace(a.toJSON());
    expect(b.recent()).toEqual(['k16']);
    expect(b.lastPath('k16')).toBe('/srv');
    expect(b.isWritable('k16')).toBe(true);
    expect(a.isWritable('k16')).toBe(false);
  });
});
