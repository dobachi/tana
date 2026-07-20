import { describe, it, expect } from 'vitest';
import {
  formatSize,
  formatMtime,
  renderMeta,
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

describe('renderers (jsdom)', () => {
  it('renderText uses textContent (no HTML injection) and flags truncation', () => {
    const c = document.createElement('div');
    renderText(c, { data: { text: '<b>&amp;</b>', truncated: true } }, document);
    const pre = c.querySelector('pre.preview-text');
    expect(pre.textContent).toBe('<b>&amp;</b>'); // literal, not parsed
    expect(pre.innerHTML).not.toContain('<b>'); // escaped
    expect(c.querySelector('.preview-truncated')).not.toBeNull();
  });

  it('renderImage sets src to the given asset URL', () => {
    const c = document.createElement('div');
    renderImage(c, { entry: { name: 'p.png' }, src: 'asset://x' }, document);
    const img = c.querySelector('img');
    expect(img.getAttribute('src')).toBe('asset://x');
    expect(img.getAttribute('alt')).toBe('p.png');
  });

  it('renderMeta shows name, kind label and note', () => {
    const c = document.createElement('div');
    renderMeta(
      c,
      {
        entry: { name: 'd', is_dir: true, path: '/p/d', size: 0 },
        kind: KIND.DIR,
        note: 'フォルダです',
      },
      document,
    );
    expect(c.querySelector('.preview-meta-name').textContent).toBe('d');
    expect(c.textContent).toContain('フォルダ');
    expect(c.querySelector('.preview-meta-note').textContent).toBe('フォルダです');
  });
});
