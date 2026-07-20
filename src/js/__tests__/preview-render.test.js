import { describe, it, expect } from 'vitest';
import {
  formatSize,
  formatMtime,
  renderInfo,
  renderPlaceholder,
  renderText,
  renderImage,
} from '../features/preview/render.js';
import { KIND } from '../core/previewkind.js';

describe('formatSize', () => {
  it('formats bytes with units', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(1048576)).toBe('1.0 MB');
    expect(formatSize(null)).toBe('—');
  });
});

describe('formatMtime', () => {
  it('formats epoch seconds and handles null', () => {
    expect(formatMtime(null)).toBe('—');
    expect(formatMtime(0)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('renderInfo (jsdom)', () => {
  const entry = { name: 'a.md', path: '/p/a.md', size: 2048, is_dir: false, modified: 0 };

  it('shows name, kind, size, modified and path', () => {
    const c = document.createElement('div');
    renderInfo(c, { entry, kind: KIND.MARKDOWN }, document);
    expect(c.querySelector('.preview-info-name').textContent).toBe('a.md');
    expect(c.textContent).toContain('Markdown');
    expect(c.textContent).toContain('2.0 KB');
    expect(c.querySelector('.preview-info-path-value').textContent).toBe('/p/a.md');
  });

  it('adds encoding/truncation rows for text', () => {
    const c = document.createElement('div');
    renderInfo(
      c,
      { entry, kind: KIND.TEXT, data: { encoding: 'utf-8', truncated: true } },
      document,
    );
    expect(c.textContent).toContain('utf-8');
    expect(c.textContent).toContain('先頭のみ');
  });

  it('shows a dimension placeholder for images', () => {
    const c = document.createElement('div');
    renderInfo(
      c,
      { entry: { name: 'p.png', path: '/p/p.png', size: 10 }, kind: KIND.IMAGE, src: 'asset://x' },
      document,
    );
    expect(c.textContent).toContain('寸法');
  });

  it('clears when entry is null', () => {
    const c = document.createElement('div');
    c.innerHTML = 'old';
    renderInfo(c, { entry: null, kind: KIND.TEXT }, document);
    expect(c.innerHTML).toBe('');
  });
});

describe('renderPlaceholder (jsdom)', () => {
  it('shows the kind label and a note', () => {
    const c = document.createElement('div');
    renderPlaceholder(c, { kind: KIND.DIR, note: 'フォルダです' }, document);
    expect(c.querySelector('.preview-placeholder-kind').textContent).toBe('フォルダ');
    expect(c.querySelector('.preview-placeholder-note').textContent).toBe('フォルダです');
  });
});

describe('content renderers (jsdom)', () => {
  it('renderText uses textContent (no HTML injection) and flags truncation', () => {
    const c = document.createElement('div');
    renderText(c, { data: { text: '<b>&amp;</b>', truncated: true } }, document);
    const pre = c.querySelector('pre.preview-text');
    expect(pre.textContent).toBe('<b>&amp;</b>');
    expect(pre.innerHTML).not.toContain('<b>');
    expect(c.querySelector('.preview-truncated')).not.toBeNull();
  });

  it('renderImage sets src to the given asset URL', () => {
    const c = document.createElement('div');
    renderImage(c, { entry: { name: 'p.png' }, src: 'asset://x' }, document);
    const img = c.querySelector('img');
    expect(img.getAttribute('src')).toBe('asset://x');
    expect(img.getAttribute('alt')).toBe('p.png');
  });
});
