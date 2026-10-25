import { describe, it, expect, vi } from 'vitest';
import { resolveImageRef, resolveMarkdownImages, MAX_MD_IMAGES } from '../core/mdimages.js';

describe('resolveImageRef — ローカル', () => {
  it('相対パスは md ファイルの場所が基準', () => {
    expect(resolveImageRef('/home/u/doc/a.md', 'img/x.png')).toEqual({
      path: '/home/u/doc/img/x.png',
    });
    expect(resolveImageRef('/home/u/doc/a.md', './x.png')).toEqual({ path: '/home/u/doc/x.png' });
    expect(resolveImageRef('/home/u/doc/a.md', '../pic/x.png')).toEqual({
      path: '/home/u/pic/x.png',
    });
  });
  it('Windows のパス（区切りは / に揃える）', () => {
    expect(resolveImageRef('C:\\Users\\u\\a.md', 'img\\x.png')).toEqual({
      path: 'C:/Users/u/img/x.png',
    });
    expect(resolveImageRef('C:/Users/u/a.md', 'D:\\p\\x.png')).toEqual({ path: 'D:/p/x.png' });
  });
  it('絶対パスはそのまま、%20・?・# は落として読む', () => {
    expect(resolveImageRef('/a/b.md', '/srv/x.png')).toEqual({ path: '/srv/x.png' });
    expect(resolveImageRef('/a/b.md', 'my%20pic.png?v=1#top')).toEqual({ path: '/a/my pic.png' });
  });
});

describe('resolveImageRef — リモート (FR-20)', () => {
  it('相対は md と同じ接続先・同じ場所が基準', () => {
    expect(resolveImageRef('sftp://k16/home/u/a.md', 'img/x.png')).toEqual({
      path: 'sftp://k16/home/u/img/x.png',
    });
    expect(resolveImageRef('sftp://k16/home/u/a.md', '../../etc/x.png')).toEqual({
      path: 'sftp://k16/etc/x.png',
    });
    expect(resolveImageRef('sftp://k16/a.md', '../../x.png')).toEqual({ path: 'sftp://k16/x.png' });
  });
  it('絶対パスは相手側の絶対パス。ドライブ指定は相手に無いので出さない', () => {
    expect(resolveImageRef('sftp://k16/home/u/a.md', '/srv/x.png')).toEqual({
      path: 'sftp://k16/srv/x.png',
    });
    expect(resolveImageRef('sftp://k16/home/u/a.md', 'C:/x.png')).toBeNull();
  });
});

describe('resolveImageRef — 表示しないもの', () => {
  it('外部 URL・他スキーム・空は null、data:image はそのまま', () => {
    for (const s of [
      'https://e.com/x.png',
      'http://e.com/x.png',
      '//e.com/x.png',
      'file:///x.png',
      'sftp://other/x.png',
      '',
      '  ',
      'javascript:alert(1)',
    ]) {
      expect(resolveImageRef('/a/b.md', s)).toBeNull();
    }
    expect(resolveImageRef('/a/b.md', 'data:image/png;base64,AAA')).toEqual({
      url: 'data:image/png;base64,AAA',
    });
    expect(resolveImageRef('/a/b.md', 'data:text/html,x')).toBeNull();
  });
});

function imgs(...srcs) {
  const c = document.createElement('div');
  for (const s of srcs) {
    const i = document.createElement('img');
    i.setAttribute('data-md-src', s);
    i.setAttribute('alt', `alt:${s}`);
    c.appendChild(i);
  }
  return c;
}

describe('resolveMarkdownImages', () => {
  it('参照先を toSrc で変換して src に入れる。解決できないものは枠だけ', async () => {
    const c = imgs('a.png', 'https://e.com/x.png', 'gone.png');
    const toSrc = vi.fn(async (p) => (p.endsWith('gone.png') ? null : `asset://${p}`));
    await resolveMarkdownImages(c, 'sftp://k16/d/r.md', { toSrc });
    const [a, ext, gone] = c.querySelectorAll('img');
    expect(a.getAttribute('src')).toBe('asset://sftp://k16/d/a.png');
    expect(ext.getAttribute('src')).toBeNull();
    expect(ext.classList.contains('md-img-missing')).toBe(true);
    expect(gone.classList.contains('md-img-missing')).toBe(true);
    expect(gone.title).toBe('alt:gone.png');
    expect(toSrc).toHaveBeenCalledTimes(2);
  });
  it('取得に失敗しても他の画像は続ける', async () => {
    const c = imgs('bad.png', 'ok.png');
    const toSrc = vi.fn(async (p) => {
      if (p.endsWith('bad.png')) throw new Error('x');
      return 'u';
    });
    await resolveMarkdownImages(c, '/d/r.md', { toSrc });
    expect(c.querySelectorAll('img')[1].getAttribute('src')).toBe('u');
  });
  it('別のファイルへ移ったら打ち切る（古い取得結果を入れない）', async () => {
    const c = imgs('a.png', 'b.png');
    let current = true;
    const toSrc = vi.fn(async () => {
      current = false;
      return 'u';
    });
    await resolveMarkdownImages(c, '/d/r.md', { toSrc, isCurrent: () => current });
    expect(toSrc).toHaveBeenCalledTimes(1);
    expect(c.querySelector('img').getAttribute('src')).toBeNull();
  });
  it(`取り寄せは ${MAX_MD_IMAGES} 枚まで`, async () => {
    const c = imgs(...Array.from({ length: MAX_MD_IMAGES + 2 }, (_, i) => `${i}.png`));
    const toSrc = vi.fn(async () => 'u');
    await resolveMarkdownImages(c, '/d/r.md', { toSrc });
    expect(toSrc).toHaveBeenCalledTimes(MAX_MD_IMAGES);
    expect(c.querySelectorAll('img.md-img-missing')).toHaveLength(2);
  });
});
