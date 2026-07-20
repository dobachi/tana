import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../features/preview/markdown.js';

describe('renderMarkdown (jsdom)', () => {
  it('renders markdown to HTML', () => {
    const c = document.createElement('div');
    renderMarkdown(c, { data: { text: '# 見出し\n\n**太字** と `code`' } }, document);
    const wrap = c.querySelector('.preview-markdown');
    expect(wrap.querySelector('h1').textContent).toBe('見出し');
    expect(wrap.querySelector('strong').textContent).toBe('太字');
    expect(wrap.querySelector('code').textContent).toBe('code');
  });

  it('does NOT pass through raw HTML (html:false, safety)', () => {
    const c = document.createElement('div');
    renderMarkdown(c, { data: { text: 'before <script>alert(1)</script> after' } }, document);
    expect(c.querySelector('script')).toBeNull(); // escaped, not executed
    expect(c.textContent).toContain('<script>'); // shown as literal text
  });

  it('blocks javascript: links', () => {
    const c = document.createElement('div');
    renderMarkdown(c, { data: { text: '[x](javascript:alert(1))' } }, document);
    const a = c.querySelector('a');
    // markdown-it's default validateLink drops the dangerous href
    if (a) expect(a.getAttribute('href')).not.toMatch(/^javascript:/);
  });

  it('shows the truncation banner when truncated', () => {
    const c = document.createElement('div');
    renderMarkdown(c, { data: { text: '# x', truncated: true } }, document);
    expect(c.querySelector('.preview-truncated')).not.toBeNull();
  });
});
