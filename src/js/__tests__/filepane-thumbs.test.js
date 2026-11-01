import { describe, it, expect, afterEach, vi } from 'vitest';

const listing = { entries: [] };
vi.mock('../backend.js', () => ({
  listDir: vi.fn(async () => listing.entries),
  parentDir: vi.fn(async () => null),
}));

const { createFilePane } = await import('../core/filepane.js');
const { createThumbLoader, isThumbable } = await import('../core/thumbs.js');

const file = (name) => ({ name, path: `/p/${name}`, is_dir: false, size: 10, modified: 1 });
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function buildPaneDom() {
  const el = document.createElement('section');
  el.className = 'pane';
  el.innerHTML = `<header class="pane-header"><span class="pane-path">—</span></header>
    <ul class="pane-list"></ul>`;
  document.body.appendChild(el);
  return el;
}

function thumbsWith(fetch, enabled = () => true) {
  return { ...createThumbLoader({ fetch }), enabled, isThumbable };
}

const OriginalIO = globalThis.IntersectionObserver;
afterEach(() => {
  document.body.innerHTML = '';
  globalThis.IntersectionObserver = OriginalIO;
});

describe('一覧の小さな写真', () => {
  it('写真のあるフォルダでは全行に枠を出し、写真の行にだけ画像を入れる', async () => {
    listing.entries = [file('a.jpg'), file('notes.txt'), { ...file('sub'), is_dir: true }];
    const fetch = vi.fn(async (e) => `asset://${e.name}`);
    const root = buildPaneDom();
    const fp = createFilePane(root, { thumbs: thumbsWith(fetch) });
    await fp.load('/p');
    await flush();
    const list = root.querySelector('.pane-list');
    expect(list.classList.contains('has-thumbs')).toBe(true);
    const rows = [...list.querySelectorAll('.entry')];
    expect(rows.every((r) => r.querySelector('.entry-thumb'))).toBe(true);
    const img = rows.find((r) => r.dataset.path === '/p/a.jpg').querySelector('.entry-thumb img');
    expect(img.getAttribute('src')).toBe('asset://a.jpg');
    expect(rows.find((r) => r.dataset.path === '/p/notes.txt').querySelector('img')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    // 名前の文字はそのまま
    expect(rows[0].querySelector('.entry-name').textContent).toMatch(/\.jpg$|sub\/|notes\.txt/);
  });

  it('写真の無いフォルダでは枠を出さない', async () => {
    listing.entries = [file('a.txt'), file('b.md')];
    const root = buildPaneDom();
    const fp = createFilePane(root, { thumbs: thumbsWith(vi.fn()) });
    await fp.load('/p');
    expect(root.querySelector('.pane-list').classList.contains('has-thumbs')).toBe(false);
    expect(root.querySelector('.entry-thumb')).toBeNull();
  });

  it('オフなら枠も読み込みも無い。オンにして refresh すると出る', async () => {
    listing.entries = [file('a.jpg')];
    let on = false;
    const fetch = vi.fn(async () => 'asset://a');
    const root = buildPaneDom();
    const fp = createFilePane(root, { thumbs: thumbsWith(fetch, () => on) });
    await fp.load('/p');
    await flush();
    expect(root.querySelector('.entry-thumb')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    on = true;
    fp.refresh();
    await flush();
    expect(root.querySelector('.entry-thumb img')).not.toBeNull();
  });

  it('描き直しでは覚えている写真をすぐ出し、読み直さない', async () => {
    listing.entries = [file('a.jpg')];
    const fetch = vi.fn(async () => 'asset://a');
    const root = buildPaneDom();
    const fp = createFilePane(root, { thumbs: thumbsWith(fetch) });
    await fp.load('/p');
    await flush();
    fp.refresh();
    // 待たずに出ている（ちらつかない）
    expect(root.querySelector('.entry-thumb img')).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('見えた行の分だけ頼む（IntersectionObserver）', async () => {
    const observers = [];
    globalThis.IntersectionObserver = class {
      constructor(cb, options) {
        this.cb = cb;
        this.options = options;
        this.targets = new Set();
        observers.push(this);
      }
      observe(t) {
        this.targets.add(t);
      }
      unobserve(t) {
        this.targets.delete(t);
      }
      disconnect() {
        this.targets.clear();
      }
    };
    listing.entries = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    const fetch = vi.fn(async (e) => `asset://${e.name}`);
    const root = buildPaneDom();
    const fp = createFilePane(root, { thumbs: thumbsWith(fetch) });
    await fp.load('/p');
    const io = observers.at(-1);
    expect(io.options.root).toBe(root.querySelector('.pane-list'));
    expect(io.targets.size).toBe(3);
    await flush();
    expect(fetch).not.toHaveBeenCalled(); // まだ何も見えていない

    const [first] = [...io.targets];
    io.cb([{ isIntersecting: true, target: first }]);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(io.targets.has(first)).toBe(false);
    expect(first.querySelector('img')).not.toBeNull();
  });

  it('thumbs を渡さなければ従来どおり', async () => {
    listing.entries = [file('a.jpg')];
    const root = buildPaneDom();
    const fp = createFilePane(root, {});
    await fp.load('/p');
    expect(root.querySelector('.entry-thumb')).toBeNull();
  });
});
