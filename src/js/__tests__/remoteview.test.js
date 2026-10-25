import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRemoteView } from '../core/remoteview.js';
import { createRemotes } from '../core/remotes.js';

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function setup(over = {}) {
  const remotes = over.remotes || createRemotes({ recent: ['k16'] });
  const deps = {
    remotes,
    getConfiguredHosts: vi.fn(async () => ['cfg1', 'k16']),
    getSessions: vi.fn(async () => over.sessions || []),
    onOpen: over.onOpen || vi.fn(async () => {}),
    onDisconnect: vi.fn(async () => {}),
    onSetWritable: vi.fn(async (h, on) => remotes.setWritable(h, on)),
  };
  const view = createRemoteView(deps);
  return { view, deps, remotes };
}

const $ = (sel) => document.querySelector(sel);
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('remoteview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('開くと最近の接続先が入り、書き込みは既定オフ', async () => {
    const { view } = setup();
    view.open();
    await flush();
    expect(view.isOpen()).toBe(true);
    expect($('.remote-host-input').value).toBe('k16');
    expect($('.remote-write-option input').checked).toBe(false);
    expect(document.activeElement).toBe($('.remote-path-input'));
  });

  it('候補は 最近 → ssh config の順で重複しない', async () => {
    const { view } = setup();
    view.open();
    await flush();
    const opts = [...document.querySelectorAll('#remote-host-candidates option')].map(
      (o) => o.value,
    );
    expect(opts).toEqual(['k16', 'cfg1']);
  });

  it('Enter で開く。URI と書き込み許可を渡し、成功で閉じる', async () => {
    const { view, deps } = setup();
    view.open();
    await flush();
    $('.remote-path-input').value = '~/notes';
    $('.remote-write-option input').checked = true;
    key($('.remote-path-input'), 'Enter');
    await flush();
    expect(deps.onOpen).toHaveBeenCalledWith('sftp://k16/~/notes', {
      host: 'k16',
      writable: true,
    });
    expect(view.isOpen()).toBe(false);
  });

  it('失敗したら閉じずに理由を出す', async () => {
    const onOpen = vi.fn(async () => {
      throw new Error('k16 に接続できません（Permission denied）');
    });
    const { view } = setup({ onOpen });
    view.open();
    await flush();
    $('.remote-open').click();
    await flush();
    expect(view.isOpen()).toBe(true);
    expect($('.remote-message').textContent).toContain('Permission denied');
    expect($('.remote-message').classList.contains('error')).toBe(true);
    expect($('.remote-open').disabled).toBe(false);
  });

  it('接続先が空・不正なら開かずに促す', async () => {
    const { view, deps } = setup({ remotes: createRemotes() });
    view.open();
    await flush();
    $('.remote-host-input').value = '-oProxyCommand=x';
    $('.remote-open').click();
    await flush();
    expect(deps.onOpen).not.toHaveBeenCalled();
    expect($('.remote-message').textContent).toContain('接続先');
  });

  it('接続中の一覧から書き込み許可の切替と切断ができる', async () => {
    const { view, deps, remotes } = setup({ sessions: [{ host: 'k16', writable: false }] });
    view.open();
    await flush();
    const cb = $('.remote-session .remote-writable input');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await flush();
    expect(deps.onSetWritable).toHaveBeenCalledWith('k16', true);
    expect(remotes.isWritable('k16')).toBe(true);
    const cut = [...document.querySelectorAll('.remote-session button')].find(
      (b) => b.textContent === '切断',
    );
    cut.click();
    await flush();
    expect(deps.onDisconnect).toHaveBeenCalledWith('k16');
  });

  it('接続が無ければその旨を出す', async () => {
    const { view } = setup();
    view.open();
    await flush();
    expect($('.remote-list').textContent).toContain('接続はありません');
  });

  it('Esc で閉じ、キーを本体へ漏らさない', async () => {
    const { view } = setup();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    view.open();
    await flush();
    key($('.remote-path-input'), 'j');
    expect(outer).not.toHaveBeenCalled();
    key($('.remote-path-input'), 'Escape');
    expect(view.isOpen()).toBe(false);
    document.removeEventListener('keydown', outer);
  });

  it('initial で接続先と場所を入れて始められる', async () => {
    const { view } = setup();
    view.open({ host: 'other', path: '/srv' });
    await flush();
    expect($('.remote-host-input').value).toBe('other');
    expect($('.remote-path-input').value).toBe('/srv');
  });

  it('toggle で開閉する', () => {
    const { view } = setup();
    view.toggle();
    expect(view.isOpen()).toBe(true);
    view.toggle();
    expect(view.isOpen()).toBe(false);
  });
});
