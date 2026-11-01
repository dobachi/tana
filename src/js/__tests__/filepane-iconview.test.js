import { describe, it, expect, afterEach, vi } from 'vitest';

const listing = { entries: [] };
vi.mock('../backend.js', () => ({
  listDir: vi.fn(async () => listing.entries),
  parentDir: vi.fn(async () => null),
}));

const { createFilePane } = await import('../core/filepane.js');
const { createThumbLoader, isThumbable } = await import('../core/thumbs.js');

const file = (name) => ({ name, path: `/p/${name}`, is_dir: false, size: 10, modified: 1 });
const dir = (name) => ({ name, path: `/p/${name}`, is_dir: true, size: 0, modified: 1 });
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function buildPaneDom() {
  const el = document.createElement('section');
  el.className = 'pane';
  el.innerHTML = `<header class="pane-header"><span class="pane-path">—</span></header>
    <div class="pane-columns"><button class="pane-col" data-sort="name">名前</button></div>
    <ul class="pane-list"></ul>`;
  document.body.appendChild(el);
  return el;
}

function thumbsWith(fetch, enabled = () => true) {
  return { ...createThumbLoader({ fetch }), enabled, isThumbable };
}

/** jsdom はレイアウトしないので、cols 列に並んだように offsetTop を与える */
function layOut(root, cols) {
  [...root.querySelectorAll('.pane-list > li')].forEach((li, i) => {
    Object.defineProperty(li, 'offsetTop', {
      configurable: true,
      value: Math.floor(i / cols) * 100,
    });
  });
}

async function paneWith(entries, opts = {}) {
  listing.entries = entries;
  const root = buildPaneDom();
  const changes = [];
  const fp = createFilePane(root, { onChange: (i) => changes.push(i), ...opts });
  await fp.load('/p');
  return { root, fp, changes, list: root.querySelector('.pane-list') };
}

const cursorName = (fp) => fp.getCursorEntry()?.name;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('アイコン表示', () => {
  it('切り替えるとタイルになり、列見出しを隠す。戻すと元どおり', async () => {
    const { root, fp, list } = await paneWith([dir('sub'), file('a.jpg'), file('n.txt')]);
    expect(fp.getView()).toBe('details');
    fp.setView('icons');
    expect(fp.getView()).toBe('icons');
    expect(list.classList.contains('icon-view')).toBe(true);
    expect(root.querySelector('.pane-columns').hidden).toBe(true);
    const tiles = [...list.querySelectorAll('li.tile')];
    expect(tiles).toHaveLength(3);
    // 名前と枠だけ（サイズ・日時はタイルの説明へ）
    expect(tiles[0].querySelector('.entry-size')).toBeNull();
    expect(tiles[0].querySelector('.entry-name').textContent).toBe('sub');
    expect(tiles[2].title).toContain('n.txt');

    fp.setView('details');
    expect(list.classList.contains('icon-view')).toBe(false);
    expect(root.querySelector('.pane-columns').hidden).toBe(false);
    expect(list.querySelector('li.tile')).toBeNull();
    expect(list.querySelector('.entry-size')).not.toBeNull();
  });

  it('壊れた値は詳細に戻す', async () => {
    const { fp } = await paneWith([file('a.txt')], { view: 'grid' });
    expect(fp.getView()).toBe('details');
  });

  it('写真は縮小画像（頼む大きさは getIconLayout から）、それ以外は印', async () => {
    const fetch = vi.fn(async (e, px) => `asset://${e.name}@${px}`);
    const { list } = await paneWith([dir('sub'), file('a.jpg'), file('n.txt')], {
      view: 'icons',
      thumbs: thumbsWith(fetch, () => false), // 詳細一覧の設定がオフでもアイコン表示では出す
      getIconLayout: () => ({ em: 6.5, px: 256 }),
    });
    await flush();
    expect(list.style.getPropertyValue('--icon-size')).toBe('6.5em');
    const [sub, jpg, txt] = [...list.querySelectorAll('li.tile .entry-thumb')];
    expect(sub.querySelector('.entry-glyph').textContent).toBe('📁');
    expect(txt.textContent).toBe('📄');
    expect(jpg.querySelector('img').getAttribute('src')).toBe('asset://a.jpg@256');
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.jpg' }), 256);
  });

  it('thumbs が無くてもタイルと印は出る', async () => {
    const { list } = await paneWith([file('a.jpg')], { view: 'icons' });
    expect(list.querySelector('li.tile .entry-thumb')).not.toBeNull();
  });
});

describe('カーソルの移動', () => {
  const ten = Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`));

  it('詳細一覧: 左右は何もしない、上下は 1 行', async () => {
    const { fp, changes } = await paneWith(ten);
    const before = changes.length;
    fp.moveCursorHorizontal(1);
    fp.moveCursorHorizontal(-1);
    expect(cursorName(fp)).toBe('f0.txt');
    expect(changes.length).toBe(before);
    fp.moveCursorVertical(1);
    expect(cursorName(fp)).toBe('f1.txt');
  });

  it('アイコン表示（4 列）: 左右は 1 つ、上下は 1 段', async () => {
    const { root, fp } = await paneWith(ten, { view: 'icons' });
    layOut(root, 4);
    fp.moveCursorHorizontal(1);
    expect(cursorName(fp)).toBe('f1.txt');
    fp.moveCursorVertical(1);
    expect(cursorName(fp)).toBe('f5.txt');
    fp.moveCursorVertical(1); // 下の段は 2 つだけ → その最後へ
    expect(cursorName(fp)).toBe('f9.txt');
    fp.moveCursorVertical(-1);
    expect(cursorName(fp)).toBe('f5.txt');
    fp.moveCursorHorizontal(-1);
    fp.moveCursorHorizontal(-1);
    expect(cursorName(fp)).toBe('f3.txt'); // 段の端からは前の段へ
  });

  it('レイアウトが測れなければ 1 列として動く', async () => {
    const { fp } = await paneWith(ten, { view: 'icons' });
    fp.moveCursorVertical(1);
    expect(cursorName(fp)).toBe('f1.txt');
  });

  it('表示を切り替えてもカーソルと選択は保つ', async () => {
    const { fp } = await paneWith(ten);
    fp.moveCursorVertical(1);
    fp.moveCursorVertical(1);
    fp.toggleSelection();
    const sel = fp.getSelectedCount();
    const cur = cursorName(fp);
    fp.setView('icons');
    expect(cursorName(fp)).toBe(cur);
    expect(fp.getSelectedCount()).toBe(sel);
  });
});
