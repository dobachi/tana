import { describe, it, expect, vi } from 'vitest';
import { createPreview } from '../core/preview.js';

// Controllable scheduler modelling debounce (set replaces via clear).
function makeScheduler() {
  let pending = null;
  return {
    set: (fn) => {
      pending = fn;
      return 1;
    },
    clear: () => {
      pending = null;
    },
    flush: () => {
      const fn = pending;
      pending = null;
      if (fn) fn();
    },
    hasPending: () => pending != null,
  };
}

function makeRenderers() {
  return {
    renderImage: vi.fn(),
    renderText: vi.fn(),
    renderPlaceholder: vi.fn(),
    renderInfo: vi.fn(),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(over = {}) {
  const container = { innerHTML: 'x' };
  const infoContainer = { innerHTML: 'x' };
  const R = makeRenderers();
  const M = { renderMarkdown: vi.fn() };
  const scheduler = makeScheduler();
  const readPreview = over.readPreview || vi.fn(async () => ({ text: 'hi', sniff: [104, 105] }));
  const assetUrl = vi.fn((p) => `asset://${p}`);
  const preview = createPreview({
    backend: { readPreview, assetUrl },
    getContainer: () => container,
    getInfoContainer: () => infoContainer,
    loadRenderers: async () => R,
    loadMarkdown: async () => M,
    doc: {},
    scheduler,
  });
  return { preview, R, M, scheduler, readPreview, assetUrl, container, infoContainer };
}

const textFile = { name: 'a.txt', path: '/p/a.txt', size: 10, is_dir: false };
const mdFile = { name: 'a.md', path: '/p/a.md', size: 10, is_dir: false };
const imgFile = { name: 'p.png', path: '/p/p.png', size: 999, is_dir: false };
const dir = { name: 'd', path: '/p/d', size: 4096, is_dir: true };

describe('createPreview — closed', () => {
  it('does no I/O while closed', async () => {
    const { preview, readPreview, R } = setup();
    preview.setTarget(textFile);
    await Promise.resolve();
    expect(readPreview).not.toHaveBeenCalled();
    expect(R.renderText).not.toHaveBeenCalled();
  });
});

describe('createPreview — routing', () => {
  it('open() loads current target immediately (text → renderText)', async () => {
    const { preview, R, readPreview } = setup();
    preview.setTarget(textFile);
    preview.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(readPreview).toHaveBeenCalledWith('/p/a.txt', expect.any(Number));
    expect(R.renderText).toHaveBeenCalledTimes(1);
  });

  it('markdown → loads markdown renderer (lazy), not renderText', async () => {
    const { preview, R, M, readPreview } = setup();
    preview.setTarget(mdFile);
    preview.open();
    await flushAll();
    expect(readPreview).toHaveBeenCalledWith('/p/a.md', expect.any(Number));
    expect(M.renderMarkdown).toHaveBeenCalledTimes(1);
    expect(R.renderText).not.toHaveBeenCalled();
  });

  it('image → renderImage with asset URL, no read', async () => {
    const { preview, R, readPreview, assetUrl, scheduler } = setup();
    preview.open(); // loads null target
    await flushAll();
    preview.setTarget(imgFile); // opened → schedules
    scheduler.flush();
    await flushAll();
    expect(readPreview).not.toHaveBeenCalled();
    expect(R.renderImage).toHaveBeenCalledTimes(1);
    expect(assetUrl).toHaveBeenCalledWith('/p/p.png');
  });
});

async function flushAll() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('createPreview — generation token', () => {
  it('discards a slow earlier load when a newer target resolves first', async () => {
    const dA = deferred();
    const dB = deferred();
    const calls = [];
    const readPreview = vi.fn((path) => {
      calls.push(path);
      return path.endsWith('A.txt') ? dA.promise : dB.promise;
    });
    const { preview, R, scheduler } = setup({ readPreview });

    preview.setTarget({ name: 'A.txt', path: '/p/A.txt', size: 5, is_dir: false });
    preview.open(); // loads A immediately (gen 1)
    await flushAll();

    // move cursor to B while A is still pending
    preview.setTarget({ name: 'B.txt', path: '/p/B.txt', size: 5, is_dir: false });
    scheduler.flush(); // debounced load B (gen 2)
    await flushAll();

    // B resolves first, then A (late) — A must be discarded
    dB.resolve({ text: 'B', sniff: [66] });
    await flushAll();
    dA.resolve({ text: 'A', sniff: [65] });
    await flushAll();

    const rendered = R.renderText.mock.calls.map((c) => c[1].data.text);
    expect(rendered).toContain('B');
    expect(rendered).not.toContain('A');
  });
});

describe('createPreview — debounce & dedupe', () => {
  it('coalesces rapid setTarget into a single load', async () => {
    const { preview, readPreview, scheduler } = setup();
    preview.open();
    await flushAll();
    preview.setTarget({ name: '1.md', path: '/p/1.md', size: 5, is_dir: false });
    preview.setTarget({ name: '2.md', path: '/p/2.md', size: 5, is_dir: false });
    preview.setTarget({ name: '3.md', path: '/p/3.md', size: 5, is_dir: false });
    expect(scheduler.hasPending()).toBe(true);
    scheduler.flush();
    await flushAll();
    // only the last target was loaded
    expect(readPreview).toHaveBeenCalledWith('/p/3.md', expect.any(Number));
    expect(readPreview).toHaveBeenCalledTimes(1);
  });

  it('ignores re-selecting the same path', async () => {
    const { preview, readPreview, scheduler } = setup();
    preview.setTarget(textFile);
    preview.open();
    await flushAll();
    expect(readPreview).toHaveBeenCalledTimes(1);
    preview.setTarget(textFile); // same path
    expect(scheduler.hasPending()).toBe(false);
  });
});

describe('createPreview — meta routing', () => {
  it('directory → placeholder + info, no read', async () => {
    const { preview, R, readPreview } = setup();
    preview.setTarget(dir);
    preview.open();
    await flushAll();
    expect(readPreview).not.toHaveBeenCalled();
    expect(R.renderPlaceholder).toHaveBeenCalledTimes(1);
    expect(R.renderPlaceholder.mock.calls[0][1].kind).toBe('dir');
    expect(R.renderInfo).toHaveBeenCalledTimes(1);
    expect(R.renderInfo.mock.calls[0][1].kind).toBe('dir');
  });

  it('text that sniffs binary → placeholder, not renderText', async () => {
    const readPreview = vi.fn(async () => ({ text: null, sniff: [0, 1, 2] }));
    const { preview, R } = setup({ readPreview });
    preview.setTarget({ name: 'x.dat', path: '/p/x.dat', size: 9, is_dir: false });
    preview.open();
    await flushAll();
    expect(R.renderPlaceholder).toHaveBeenCalled();
    expect(R.renderText).not.toHaveBeenCalled();
  });

  it('always renders the info panel alongside content (text)', async () => {
    const { preview, R } = setup();
    preview.setTarget(textFile);
    preview.open();
    await flushAll();
    expect(R.renderText).toHaveBeenCalledTimes(1);
    expect(R.renderInfo).toHaveBeenCalledTimes(1);
    expect(R.renderInfo.mock.calls[0][1].kind).toBe('text');
  });
});

describe('createPreview — close', () => {
  it('close() clears container and invalidates in-flight load', async () => {
    const d = deferred();
    const readPreview = vi.fn(() => d.promise);
    const { preview, R, container } = setup({ readPreview });
    preview.setTarget(textFile);
    preview.open();
    await flushAll();
    preview.close();
    expect(container.innerHTML).toBe('');
    d.resolve({ text: 'late', sniff: [104] });
    await flushAll();
    expect(R.renderText).not.toHaveBeenCalled();
  });
});
