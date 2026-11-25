import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorkspacesView } from '../core/workspacesview.js';
import { createWorkspaces, DEFAULT_WORKSPACE } from '../core/workspaces.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const q = (sel) => document.querySelector(sel);
const rows = () => [...document.querySelectorAll('.ws-row')];
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

function setup(over = {}) {
  const workspaces = over.workspaces || createWorkspaces();
  if (!over.workspaces) workspaces.add('notes');
  const answers = [...(over.answers || [])];
  const asked = [];
  const view = createWorkspacesView({
    workspaces,
    onSwitch: over.onSwitch || vi.fn(),
    ask: async (title) => {
      asked.push(title);
      return answers.length ? answers.shift() : null;
    },
    isMain: () => over.isMain !== false,
    notify: over.notify || vi.fn(),
  });
  return { workspaces, view, asked };
}

describe('workspacesview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('一覧に使用中の印、選択は使用中から始まる', () => {
    const { view } = setup();
    view.open();
    expect(rows().map((r) => r.querySelector('.ws-name').textContent)).toEqual([
      DEFAULT_WORKSPACE,
      'notes',
    ]);
    expect(rows()[0].classList.contains('selected')).toBe(true);
    expect(rows()[0].querySelector('.ws-active-tag')).not.toBeNull();
    expect(q('.ws-switch').disabled).toBe(true);
    expect(q('.ws-remove').disabled).toBe(true);
  });

  it('j で選んで Enter で切り替え、閉じる', () => {
    const onSwitch = vi.fn();
    const { view } = setup({ onSwitch });
    view.open();
    key(rows()[0], 'j');
    expect(rows()[1].classList.contains('selected')).toBe(true);
    key(rows()[1], 'Enter');
    expect(onSwitch).toHaveBeenCalledWith('notes');
    expect(view.isOpen()).toBe(false);
  });

  it('使用中を選んで Enter しても何もしない（最初のウィンドウ）', () => {
    const onSwitch = vi.fn();
    const { view } = setup({ onSwitch });
    view.open();
    key(rows()[0], 'Enter');
    expect(onSwitch).not.toHaveBeenCalled();
    expect(view.isOpen()).toBe(true);
  });

  it('追加ウィンドウでは「このウィンドウで開く」で、使用中も開ける', () => {
    const onSwitch = vi.fn();
    const { view } = setup({ onSwitch, isMain: false });
    view.open();
    expect(q('.ws-switch').textContent).toBe('このウィンドウで開く');
    q('.ws-switch').click();
    expect(onSwitch).toHaveBeenCalledWith(DEFAULT_WORKSPACE);
  });

  it('n で新規、使えない名前は聞き直す', async () => {
    const { view, workspaces, asked } = setup({ answers: ['notes', '執筆'] });
    view.open();
    key(rows()[0], 'n');
    await tick();
    await tick();
    expect(asked[1]).toMatch(/既に/);
    expect(workspaces.list().map((w) => w.name)).toContain('執筆');
    expect(q('.ws-row.selected .ws-name').textContent).toBe('執筆');
  });

  it('r で名前を変更（使用中は使用中のまま）', async () => {
    const { view, workspaces } = setup({ answers: ['仕事'] });
    view.open();
    key(rows()[0], 'r');
    await tick();
    expect(workspaces.active()).toBe('仕事');
  });

  it('x で使用中でないものを削除、使用中は知らせて消さない', () => {
    const notify = vi.fn();
    const { view, workspaces } = setup({ notify });
    view.open();
    key(rows()[0], 'x');
    expect(notify).toHaveBeenCalled();
    key(rows()[0], 'j');
    key(rows()[1], 'x');
    expect(workspaces.list().map((w) => w.name)).toEqual([DEFAULT_WORKSPACE]);
  });

  it('選んだワークスペースの保存する項目を変える。場所を外すとタブは選べない', () => {
    const { view, workspaces } = setup();
    view.open();
    rows()[1].click();
    expect(q('.ws-keep-title').textContent).toContain('notes');
    const dirs = q('[data-keep="dirs"]');
    dirs.checked = false;
    dirs.dispatchEvent(new Event('change'));
    expect(workspaces.get('notes').keep.dirs).toBe(false);
    expect(workspaces.get(DEFAULT_WORKSPACE).keep.dirs).toBe(true);
    expect(q('[data-keep="tabs"]').disabled).toBe(true);
  });

  it('保存済みはタブ数、未保存はその旨を表示', () => {
    const workspaces = createWorkspaces(null, {
      dirs: { left: '/a', right: '/b' },
      tabs: { left: ['/a', '/x'] },
    });
    workspaces.add('empty');
    const { view } = setup({ workspaces });
    view.open();
    expect(rows()[0].querySelector('.ws-meta').textContent).toBe('左 2 / 右 1 タブ');
    expect(rows()[1].querySelector('.ws-meta').textContent).toMatch(/まだ/);
  });

  it('Escape で閉じる。名前の入力中は閉じない', async () => {
    let release;
    const workspaces = createWorkspaces();
    const view = createWorkspacesView({
      workspaces,
      onSwitch: vi.fn(),
      ask: () => new Promise((r) => (release = r)),
    });
    view.open();
    key(rows()[0], 'n');
    key(rows()[0], 'Escape');
    expect(view.isOpen()).toBe(true);
    release(null);
    await tick();
    key(rows()[0], 'Escape');
    expect(view.isOpen()).toBe(false);
  });

  it('右上の × で閉じる', () => {
    const { view } = setup();
    view.open();
    q('.modal-close').click();
    expect(view.isOpen()).toBe(false);
  });
});
