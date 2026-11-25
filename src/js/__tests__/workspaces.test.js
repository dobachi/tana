import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_WORKSPACE,
  KEEP_ITEMS,
  defaultKeep,
  normalizeKeep,
  cleanSession,
  filterSession,
  sessionToLayout,
  normalizeStore,
  nameError,
  createWorkspaces,
  loadStoredWorkspaces,
  storeWorkspaces,
} from '../core/workspaces.js';

const SESSION = {
  dirs: { left: '/a2', right: '/c' },
  active: 'right',
  tabs: { left: ['/a1', '/a2'], right: ['/c'] },
  activeTab: { left: 1, right: 0 },
};

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

describe('keep', () => {
  it('既定は全部保存、false だけが「保存しない」', () => {
    expect(Object.keys(defaultKeep())).toEqual(KEEP_ITEMS.map((i) => i.key));
    expect(Object.values(defaultKeep()).every(Boolean)).toBe(true);
    expect(normalizeKeep({ tabs: false, dirs: 0 })).toEqual({ ...defaultKeep(), tabs: false });
    expect(normalizeKeep(null)).toEqual(defaultKeep());
  });
});

describe('cleanSession / filterSession', () => {
  it('不正な値を捨てて同じ形にそろえる', () => {
    expect(cleanSession(null)).toBeNull();
    expect(cleanSession({ dirs: { left: 1 }, tabs: { left: [] }, active: 'x' })).toEqual({
      dirs: { left: null, right: null },
      active: 'left',
      tabs: { left: null, right: null },
      activeTab: { left: 0, right: 0 },
    });
  });

  it('全部保存ならそのまま', () => {
    expect(filterSession(SESSION, defaultKeep())).toEqual(SESSION);
  });

  it('タブを保存しないなら、場所（アクティブなタブ）だけ残す', () => {
    const s = filterSession(SESSION, { ...defaultKeep(), tabs: false });
    expect(s.dirs).toEqual(SESSION.dirs);
    expect(s.tabs).toEqual({ left: null, right: null });
    expect(s.activeTab).toEqual({ left: 0, right: 0 });
  });

  it('場所を保存しないなら、タブも残さない', () => {
    const s = filterSession(SESSION, { ...defaultKeep(), dirs: false });
    expect(s.dirs).toEqual({ left: null, right: null });
    expect(s.tabs).toEqual({ left: null, right: null });
  });

  it('アクティブなペインを保存しないなら左', () => {
    expect(filterSession(SESSION, { ...defaultKeep(), active_pane: false }).active).toBe('left');
  });
});

describe('sessionToLayout', () => {
  it('タブがあればタブ、無ければ場所1つ、それも無ければ空', () => {
    expect(sessionToLayout(SESSION)).toEqual({
      left: ['/a1', '/a2'],
      right: ['/c'],
      activeLeft: 1,
      activeRight: 0,
      active: 'right',
    });
    expect(sessionToLayout({ dirs: { left: '/x' } })).toMatchObject({ left: ['/x'], right: [] });
    expect(sessionToLayout(null)).toMatchObject({ left: [], right: [], active: 'left' });
  });

  it('アクティブ index はタブ数に収める', () => {
    const l = sessionToLayout({ tabs: { left: ['/a'] }, activeTab: { left: 5 } });
    expect(l.activeLeft).toBe(0);
  });
});

describe('normalizeStore', () => {
  it('何も無ければ前回のセッションを default にする', () => {
    const st = normalizeStore(null, SESSION);
    expect(st.active).toBe(DEFAULT_WORKSPACE);
    expect(st.items).toEqual([{ name: DEFAULT_WORKSPACE, keep: defaultKeep(), session: SESSION }]);
  });

  it('旧形式（スナップショットの配列）を同名のワークスペースへ移す', () => {
    const old = [
      {
        id: 1,
        name: 'work',
        left: ['/w1', '/w2'],
        right: ['/r'],
        activeLeft: 1,
        activeRight: 0,
        active: 'right',
      },
      { id: 2, name: 'default', left: ['/dup'] }, // 名前が default と重なるものは捨てる
      { id: 3, name: '', left: ['/x'] },
    ];
    const st = normalizeStore(old, SESSION);
    expect(st.active).toBe(DEFAULT_WORKSPACE);
    expect(st.items.map((w) => w.name)).toEqual([DEFAULT_WORKSPACE, 'work']);
    expect(st.items[0].session).toEqual(SESSION);
    expect(st.items[1].session).toEqual({
      dirs: { left: '/w2', right: '/r' },
      active: 'right',
      tabs: { left: ['/w1', '/w2'], right: ['/r'] },
      activeTab: { left: 1, right: 0 },
    });
  });

  it('新形式は重複・名無しを捨て、使用中が無ければ先頭', () => {
    const st = normalizeStore({
      active: 'gone',
      items: [
        { name: ' a ', keep: { tabs: false }, session: SESSION },
        { name: 'a' },
        { name: '' },
        null,
      ],
    });
    expect(st.items.map((w) => w.name)).toEqual(['a']);
    expect(st.active).toBe('a');
    expect(st.items[0].session.tabs).toEqual({ left: null, right: null }); // keep で絞られる
  });

  it('壊れたものは default だけで始める', () => {
    expect(normalizeStore('x', null).items).toEqual([
      { name: DEFAULT_WORKSPACE, keep: defaultKeep(), session: null },
    ]);
  });
});

describe('nameError', () => {
  const items = [{ name: 'a' }];
  it('空・長すぎ・重複を断り、リネームで自分は除く', () => {
    expect(nameError(' ', items)).toMatch(/入力/);
    expect(nameError('x'.repeat(65), items)).toMatch(/64/);
    expect(nameError('a', items)).toMatch(/既に/);
    expect(nameError('a', items, 'a')).toBeNull();
    expect(nameError('b', items)).toBeNull();
  });
});

describe('createWorkspaces', () => {
  it('使用中のワークスペースにセッションを記録し、変化が無ければ通知しない', () => {
    const ws = createWorkspaces();
    const seen = vi.fn();
    ws.subscribe(seen);
    ws.record(SESSION);
    ws.record(SESSION);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(ws.activeSession()).toEqual(SESSION);
  });

  it('ワークスペースごとにセッションが分かれる', () => {
    const ws = createWorkspaces(null, SESSION);
    ws.add('notes');
    ws.setActive('notes');
    expect(ws.activeSession()).toBeNull();
    ws.record({ dirs: { left: '/n', right: '/n' } });
    expect(ws.get(DEFAULT_WORKSPACE).session).toEqual(SESSION);
    expect(ws.get('notes').session.dirs.left).toBe('/n');
  });

  it('記録は保存する項目だけ', () => {
    const ws = createWorkspaces();
    ws.setKeep(DEFAULT_WORKSPACE, { ...defaultKeep(), tabs: false });
    ws.record(SESSION);
    expect(ws.activeSession().tabs).toEqual({ left: null, right: null });
    expect(ws.activeSession().dirs).toEqual(SESSION.dirs);
  });

  it('保存する項目を減らすと、保存済みからも落とす', () => {
    const ws = createWorkspaces(null, SESSION);
    ws.setKeep(DEFAULT_WORKSPACE, { ...defaultKeep(), dirs: false });
    expect(ws.activeSession().dirs).toEqual({ left: null, right: null });
  });

  it('追加・名前の変更（使用中は追従）・不正な名前は例外', () => {
    const ws = createWorkspaces();
    ws.add('a');
    expect(() => ws.add('a')).toThrow(/既に/);
    expect(() => ws.add('')).toThrow();
    ws.rename(DEFAULT_WORKSPACE, '仕事');
    expect(ws.active()).toBe('仕事');
    expect(() => ws.rename('a', '仕事')).toThrow(/既に/);
    ws.rename('a', 'b');
    expect(ws.list().map((w) => w.name)).toEqual(['仕事', 'b']);
  });

  it('使用中と最後の1つは削除できない', () => {
    const ws = createWorkspaces();
    expect(() => ws.remove(DEFAULT_WORKSPACE)).toThrow(/使用中/);
    ws.add('a');
    ws.remove('a');
    expect(ws.list()).toHaveLength(1);
  });

  it('list は使用中に印を付けた写しを返す', () => {
    const ws = createWorkspaces(null, SESSION);
    ws.add('a');
    const l = ws.list();
    expect(l.map((w) => w.active)).toEqual([true, false]);
    l[0].session.dirs.left = '/changed';
    expect(ws.activeSession().dirs.left).toBe('/a2');
  });
});

describe('永続化', () => {
  it('保存したものを読み戻せ、壊れたものは null', () => {
    const storage = memStorage();
    const ws = createWorkspaces(null, SESSION);
    ws.add('a');
    storeWorkspaces(ws.toJSON(), storage);
    const back = createWorkspaces(loadStoredWorkspaces(storage));
    expect(back.toJSON()).toEqual(ws.toJSON());
    storage.setItem('tana.workspaces', '{broken');
    expect(loadStoredWorkspaces(storage)).toBeNull();
  });
});
