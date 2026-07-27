import { describe, it, expect, vi } from 'vitest';
import { createWorkspaces, loadStoredWorkspaces, storeWorkspaces } from '../core/workspaces.js';

const SNAP = { left: ['/a', '/b'], right: ['/c'], activeLeft: 1, activeRight: 0, active: 'left' };

describe('createWorkspaces', () => {
  it('save で追加し list/get で取り出せる', () => {
    const ws = createWorkspaces();
    const id = ws.save('仕事', SNAP);
    expect(id).not.toBeNull();
    expect(ws.list()).toHaveLength(1);
    const got = ws.get(id);
    expect(got.name).toBe('仕事');
    expect(got.left).toEqual(['/a', '/b']);
    expect(got.activeLeft).toBe(1);
  });

  it('同名は上書き（増えない）', () => {
    const ws = createWorkspaces();
    const id1 = ws.save('x', { left: ['/1'] });
    const id2 = ws.save('x', { left: ['/2'] });
    expect(id1).toBe(id2);
    expect(ws.list()).toHaveLength(1);
    expect(ws.get(id1).left).toEqual(['/2']);
  });

  it('名前空・タブ空は保存しない', () => {
    const ws = createWorkspaces();
    expect(ws.save('', SNAP)).toBeNull();
    expect(ws.save('空', { left: [], right: [] })).toBeNull();
    expect(ws.list()).toHaveLength(0);
  });

  it('remove で削除', () => {
    const ws = createWorkspaces();
    const id = ws.save('x', SNAP);
    ws.remove(id);
    expect(ws.list()).toHaveLength(0);
  });

  it('subscribe が変更で発火', () => {
    const ws = createWorkspaces();
    const fn = vi.fn();
    ws.subscribe(fn);
    ws.save('x', SNAP);
    expect(fn).toHaveBeenCalled();
  });

  it('list は複製を返す（外から壊れない）', () => {
    const ws = createWorkspaces();
    const id = ws.save('x', SNAP);
    ws.list()[0].left.push('/zzz');
    expect(ws.get(id).left).toEqual(['/a', '/b']);
  });
});

describe('load/storeWorkspaces', () => {
  function mem() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  }

  it('round-trip し、不正項目は捨てる', () => {
    const s = mem();
    storeWorkspaces(
      [
        { name: 'ok', left: ['/a'], right: [], activeLeft: 0, activeRight: 0, active: 'left' },
        { name: '', left: ['/x'] }, // 名前空→捨てる
        { name: 'noTabs', left: [], right: [] }, // タブ無し→捨てる
      ],
      s,
    );
    const loaded = loadStoredWorkspaces(s);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('ok');
  });

  it('未保存は空配列', () => {
    expect(loadStoredWorkspaces(mem())).toEqual([]);
  });
});
