import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../backend.js', () => ({
  listDir: vi.fn(async () => []),
  parentDir: vi.fn(async () => null),
}));

const { createFilePane } = await import('../core/filepane.js');

// 長いパスはブレッドクラムの途中を「…」に畳み、現在地（右端）を残す
// jsdom はレイアウトしないので、幅は文字数 × 10px で擬似的に与える
function stubLayout(available) {
  const width = (el) => (el.textContent || '').length * 10;
  const ow = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    return width(this);
  });
  const cw = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function () {
    return this.classList.contains('pane-path') ? available : 0;
  });
  return () => {
    ow.mockRestore();
    cw.mockRestore();
  };
}

function buildPaneDom() {
  const el = document.createElement('section');
  el.className = 'pane';
  el.innerHTML = `<header class="pane-header"><span class="pane-path">—</span>
    <input class="pane-path-input" type="text" /></header>
    <ul class="pane-list"></ul>`;
  document.body.appendChild(el);
  return el;
}

const labels = (root) => [...root.querySelectorAll('.pane-path .crumb')].map((b) => b.textContent);
const shown = (root) => root.querySelector('.pane-path').textContent;

let restore = null;
afterEach(() => {
  if (restore) restore();
  restore = null;
  document.body.innerHTML = '';
});

describe('ブレッドクラムの途中省略', () => {
  it('入り切るなら全階層をそのまま出す', async () => {
    restore = stubLayout(1000);
    const root = buildPaneDom();
    const pane = createFilePane(root, {});
    await pane.load('/home/user/docs');
    expect(labels(root)).toEqual(['/', 'home', 'user', 'docs']);
    expect(root.querySelector('.crumb-ellipsis')).toBeNull();
  });

  it('入り切らなければ先頭と末尾を残して途中を … にする', async () => {
    // /home/user/projects/very/deep/current = 37 文字 → 370px
    restore = stubLayout(250);
    const root = buildPaneDom();
    const pane = createFilePane(root, {});
    await pane.load('/home/user/projects/very/deep/current');
    const l = labels(root);
    expect(l[0]).toBe('/');
    expect(l[1]).toBe('…');
    expect(l[l.length - 1]).toBe('current');
    expect(l).not.toContain('home');
    // 畳んだ後の幅が表示幅に収まる
    expect(shown(root).length * 10).toBeLessThanOrEqual(250);
    // 現在地は .current のまま
    expect(root.querySelector('.crumb.current').textContent).toBe('current');
  });

  it('… は畳んだ中で最も深い階層を指し、押すとそこへ移動する', async () => {
    restore = stubLayout(250);
    const root = buildPaneDom();
    const onNavigate = vi.fn();
    const pane = createFilePane(root, { onNavigate });
    await pane.load('/home/user/projects/very/deep/current');
    const ell = root.querySelector('.crumb-ellipsis');
    const hiddenDeepest = ell.dataset.path;
    // 畳まれた最深の階層の次（表示されている 3 番目）の親であること
    const next = root.querySelectorAll('.pane-path .crumb')[2];
    expect(next.dataset.path.startsWith(hiddenDeepest + '/')).toBe(true);
    expect(ell.title).toBe(hiddenDeepest);
    ell.click();
    expect(onNavigate).toHaveBeenCalledWith(hiddenDeepest);
  });

  it('Windows のドライブでは先頭の後ろに区切りを入れて … を置く', async () => {
    restore = stubLayout(200);
    const root = buildPaneDom();
    const pane = createFilePane(root, {});
    await pane.load('C:/Users/someone/Documents/work/current');
    const text = shown(root);
    expect(text.startsWith('C:/…/')).toBe(true);
    expect(text.endsWith('current')).toBe(true);
  });

  it('2 階層以下は畳まない（末尾の切り落としは CSS 任せ）', async () => {
    restore = stubLayout(30);
    const root = buildPaneDom();
    const pane = createFilePane(root, {});
    await pane.load('/averyveryverylongname');
    expect(root.querySelector('.crumb-ellipsis')).toBeNull();
    expect(labels(root)).toEqual(['/', 'averyveryverylongname']);
  });
});
