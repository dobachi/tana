import { describe, it, expect, vi } from 'vitest';
import {
  THUMBS_KEY,
  THUMB_MAX_BYTES,
  THUMB_MEMO_MAX,
  createThumbLoader,
  isThumbable,
  loadThumbnails,
  storeThumbnails,
  thumbKey,
} from '../core/thumbs.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

const file = (name, extra = {}) => ({
  name,
  path: `/p/${name}`,
  is_dir: false,
  size: 1000,
  modified: 1,
  ...extra,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('設定（小さな写真）', () => {
  it('既定はオン、off を保存したときだけオフ', () => {
    const s = memStorage();
    expect(loadThumbnails(s)).toBe(true);
    storeThumbnails(false, s);
    expect(s.getItem(THUMBS_KEY)).toBe('off');
    expect(loadThumbnails(s)).toBe(false);
    storeThumbnails(true, s);
    expect(loadThumbnails(s)).toBe(true);
  });

  it('保存先が使えなくても落ちない', () => {
    const broken = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(loadThumbnails(broken)).toBe(true);
    expect(() => storeThumbnails(false, broken)).not.toThrow();
  });
});

describe('isThumbable', () => {
  it('扱える形式（大文字も）', () => {
    for (const n of ['a.jpg', 'b.JPEG', 'c.png', 'd.gif', 'e.webp', 'f.BMP', 'g.jpe']) {
      expect(isThumbable(file(n))).toBe(true);
    }
  });

  it('扱わないもの', () => {
    for (const n of ['a.heic', 'b.mp4', 'c.txt', 'jpg', 'd.svg', 'e.tiff']) {
      expect(isThumbable(file(n))).toBe(false);
    }
    expect(isThumbable(file('dir.jpg', { is_dir: true }))).toBe(false);
    expect(isThumbable({ name: '..', path: '/', is_dir: true, is_parent: true })).toBe(false);
    expect(isThumbable(file('big.jpg', { size: THUMB_MAX_BYTES + 1 }))).toBe(false);
    expect(isThumbable(file('r.jpg', { path: 'sftp://k16/home/u/r.jpg' }))).toBe(false);
    expect(isThumbable(null)).toBe(false);
  });

  it('鍵は更新日時・サイズが変われば変わる', () => {
    const a = file('a.jpg');
    expect(thumbKey(a)).toBe(thumbKey({ ...a }));
    expect(thumbKey(a)).not.toBe(thumbKey({ ...a, modified: 2 }));
    expect(thumbKey(a)).not.toBe(thumbKey({ ...a, size: 2 }));
    expect(thumbKey(a, 64)).toBe(thumbKey(a));
    expect(thumbKey(a, 128)).not.toBe(thumbKey(a, 64));
  });
});

describe('createThumbLoader', () => {
  function deferredFetch() {
    const pending = [];
    const fetch = vi.fn(
      (entry) =>
        new Promise((resolve, reject) => {
          pending.push({ entry, resolve, reject });
        }),
    );
    return { fetch, pending };
  }

  it('同時に concurrency 枚まで。終わったら次へ', async () => {
    const { fetch, pending } = deferredFetch();
    const loader = createThumbLoader({ fetch, concurrency: 2 });
    const results = ['a', 'b', 'c'].map((n) => loader.load(file(`${n}.jpg`)));
    expect(fetch).toHaveBeenCalledTimes(0); // まだ始まっていない（マイクロタスク）
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loader.pendingCount()).toBe(1);
    pending[0].resolve('url-a');
    await tick();
    expect(fetch).toHaveBeenCalledTimes(3);
    pending[1].resolve(null);
    pending[2].reject(new Error('broken'));
    expect(await Promise.all(results)).toEqual(['url-a', null, null]);
    expect(loader.runningCount()).toBe(0);
  });

  it('結果を覚え、同じ写真は二度頼まない（memo を共有する loader 同士でも）', async () => {
    const fetch = vi.fn(async (e) => `url:${e.name}`);
    const memo = new Map();
    const a = createThumbLoader({ fetch, memo });
    const b = createThumbLoader({ fetch, memo });
    const e = file('x.jpg');
    expect(a.peek(e)).toBeUndefined();
    const [r1, r2] = await Promise.all([a.load(e), a.load(e)]);
    expect([r1, r2]).toEqual(['url:x.jpg', 'url:x.jpg']);
    expect(await b.load(e)).toBe('url:x.jpg');
    expect(b.peek(e)).toBe('url:x.jpg');
    expect(fetch).toHaveBeenCalledTimes(1);
    // 大きさが違えば別に頼み、fetch に大きさが渡る
    expect(await a.load(e, 256)).toBe('url:x.jpg');
    expect(fetch).toHaveBeenLastCalledWith(e, 256);
    expect(a.peek(e, 256)).toBe('url:x.jpg');
    // 写真が変わったら頼み直す
    await a.load({ ...e, modified: 9 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('左右のペインが同時に頼んでも 1 回だけ読む', async () => {
    const pending = [];
    const fetch = vi.fn(() => new Promise((r) => pending.push(r)));
    const memo = new Map();
    const left = createThumbLoader({ fetch, memo });
    const right = createThumbLoader({ fetch, memo });
    const e = file('both.jpg');
    const p1 = left.load(e);
    const p2 = right.load(e);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    pending[0]('url-both');
    expect(await Promise.all([p1, p2])).toEqual(['url-both', 'url-both']);
    expect(right.runningCount()).toBe(0);
  });

  it('失敗も覚える（壊れたファイルを何度も読まない）', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('x');
    });
    const loader = createThumbLoader({ fetch });
    const e = file('bad.jpg');
    expect(await loader.load(e)).toBeNull();
    expect(loader.peek(e)).toBeNull();
    await loader.load(e);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancel で順番待ちの分は null で終わり、読み込み中の分は最後まで行う', async () => {
    const { fetch, pending } = deferredFetch();
    const loader = createThumbLoader({ fetch, concurrency: 1 });
    const first = loader.load(file('a.jpg'));
    const second = loader.load(file('b.jpg'));
    await tick();
    loader.cancel();
    expect(await second).toBeNull();
    pending[0].resolve('url-a');
    expect(await first).toBe('url-a');
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    // 取り消した分は覚えない（また見えたら頼む）
    expect(loader.peek(file('b.jpg'))).toBeUndefined();
  });

  it('覚える数には上限がある（古いものから忘れる）', async () => {
    const memo = new Map();
    for (let i = 0; i < THUMB_MEMO_MAX; i++) memo.set(`k${i}`, null);
    const loader = createThumbLoader({ fetch: async () => 'u', memo });
    await loader.load(file('new.jpg'));
    expect(memo.size).toBe(THUMB_MEMO_MAX);
    expect(memo.has('k0')).toBe(false);
    expect(loader.peek(file('new.jpg'))).toBe('u');
  });
});
