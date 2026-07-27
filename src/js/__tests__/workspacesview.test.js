import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorkspacesView } from '../core/workspacesview.js';
import { createWorkspaces } from '../core/workspaces.js';

const SNAP = { left: ['/a', '/b'], right: ['/c'], activeLeft: 0, activeRight: 0, active: 'left' };

function setup(over = {}) {
  const workspaces = over.workspaces || createWorkspaces();
  const view = createWorkspacesView({
    workspaces,
    getContext: () => ({ snapshot: SNAP, suggestedName: 'work' }),
    onOpen: over.onOpen || vi.fn(),
  });
  return { workspaces, view };
}

describe('workspacesview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('open で入力欄に既定名が入る', () => {
    const { view } = setup();
    view.open();
    expect(view.isOpen()).toBe(true);
    expect(document.querySelector('.ws-input').value).toBe('work');
  });

  it('保存ボタンで現在の構成を保存し一覧に出る', () => {
    const { view, workspaces } = setup();
    view.open();
    document.querySelector('.ws-input').value = 'マイ作業';
    document.querySelector('.ws-save').click();
    expect(workspaces.list().map((w) => w.name)).toContain('マイ作業');
    expect([...document.querySelectorAll('.ws-name')].map((n) => n.textContent)).toContain(
      'マイ作業',
    );
  });

  it('保存済みは左右のタブ数を表示', () => {
    const workspaces = createWorkspaces();
    workspaces.save('既存', SNAP);
    const { view } = setup({ workspaces });
    view.open();
    expect(document.querySelector('.ws-meta').textContent).toBe('左 2 / 右 1 タブ');
  });

  it('行クリックで onOpen を呼び閉じる', () => {
    const workspaces = createWorkspaces();
    const id = workspaces.save('既存', SNAP);
    const onOpen = vi.fn();
    const { view } = setup({ workspaces, onOpen });
    view.open();
    document.querySelector('.ws-row').click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id, name: '既存' }));
    expect(view.isOpen()).toBe(false);
  });

  it('× で削除', () => {
    const workspaces = createWorkspaces();
    workspaces.save('消す', SNAP);
    const { view } = setup({ workspaces });
    view.open();
    document.querySelector('.ws-remove').click();
    expect(workspaces.list()).toHaveLength(0);
    expect(document.querySelector('.ws-list .placeholder')).not.toBeNull();
  });

  it('Escape で閉じる', () => {
    const { view } = setup();
    view.open();
    document
      .querySelector('.ws-overlay')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.isOpen()).toBe(false);
  });
});
