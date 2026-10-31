import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../backend.js', () => ({
  listDir: vi.fn(async () => []),
  parentDir: vi.fn(async () => null),
}));

const { createFilePane } = await import('../core/filepane.js');

// ペイン見出しの ↻（再読込）ボタン
function buildPaneDom() {
  const el = document.createElement('section');
  el.className = 'pane';
  el.innerHTML = `<header class="pane-header"><span class="pane-path">—</span>
    <input class="pane-path-input" type="text" />
    <button class="pane-reload" type="button">↻</button></header>
    <ul class="pane-list"></ul>`;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('見出しの再読込ボタン', () => {
  it('押すと onReload が呼ばれる', () => {
    const root = buildPaneDom();
    const onReload = vi.fn();
    createFilePane(root, { onReload });
    root.querySelector('.pane-reload').click();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('クリックは見出しの外へ伝えない（見出しの右クリック等と干渉しない）', () => {
    const root = buildPaneDom();
    const outer = vi.fn();
    root.addEventListener('click', outer);
    createFilePane(root, { onReload: vi.fn() });
    root.querySelector('.pane-reload').click();
    expect(outer).not.toHaveBeenCalled();
  });

  it('onReload が無くても押して壊れない', () => {
    const root = buildPaneDom();
    createFilePane(root, {});
    expect(() => root.querySelector('.pane-reload').click()).not.toThrow();
  });

  it('index.html の両ペインにボタンがある', () => {
    const html = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');
    expect(html.match(/class="pane-reload"/g)).toHaveLength(2);
  });
});
