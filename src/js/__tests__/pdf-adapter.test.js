import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../backend.js', () => ({ readExtensionFile: vi.fn() }));

import { loadEngine, resetEngine, renderPdf, RUNNER_URL } from '../features/pdf/adapter.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadEngine', () => {
  beforeEach(() => resetEngine());

  it('拡張 pdfjs の4ファイルを読み、使い回す', async () => {
    const read = vi.fn(async (id, rel) => `${id}:${rel}`);
    const e = await loadEngine(read);
    expect(e).toEqual({
      pdf: 'pdfjs:pdf.min.mjs',
      worker: 'pdfjs:pdf.worker.js',
      cmaps: 'pdfjs:cmaps.json',
      fonts: 'pdfjs:standard_fonts.json',
    });
    await loadEngine(read);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('失敗したら次回は読み直す。resetEngine でも読み直す', async () => {
    const bad = vi.fn(async () => {
      throw new Error('not installed');
    });
    await expect(loadEngine(bad)).rejects.toThrow('not installed');
    const good = vi.fn(async () => 'x');
    await loadEngine(good);
    resetEngine();
    await loadEngine(good);
    expect(good).toHaveBeenCalledTimes(8);
  });
});

describe('renderPdf', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="c">old</div>';
  });

  function mount(extra = {}) {
    const container = document.getElementById('c');
    const engine = { pdf: 'p', worker: 'w', cmaps: '{}', fonts: '{}' };
    const load = vi.fn(async () => engine);
    const data = new ArrayBuffer(8);
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const frame = renderPdf(container, { data, dark: true, onLoaded, onError }, document, {
      loadEngine: load,
      ...extra,
    });
    const post = vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
    const send = (msg, source = frame.contentWindow) =>
      window.dispatchEvent(new MessageEvent('message', { data: msg, source }));
    return { container, frame, load, data, onLoaded, onError, post, send, engine };
  }

  it('アプリの権限を持たない sandbox iframe で runner を開く', () => {
    const { container, frame } = mount();
    expect(container.children).toHaveLength(1);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe(RUNNER_URL);
    expect(frame.tabIndex).toBe(-1);
  });

  it('runner の準備ができたらエンジンと PDF を渡す', async () => {
    const { send, post, data, engine } = mount();
    send({ type: 'ready' });
    await flush();
    expect(post).toHaveBeenCalledWith({ type: 'show', engine, data, dark: true }, '*', [data]);
  });

  it('ページ数とエラーを伝える。ほかの窓からの通知は無視する', async () => {
    const { send, onLoaded, onError } = mount();
    send({ type: 'loaded', pages: 5 }, window);
    expect(onLoaded).not.toHaveBeenCalled();
    send({ type: 'loaded', pages: 5 });
    expect(onLoaded).toHaveBeenCalledWith(5);
    send({ type: 'error', message: 'パスワード付きの PDF は表示できません' });
    expect(onError).toHaveBeenCalledWith('パスワード付きの PDF は表示できません');
  });

  it('エンジンを読めなければエラーとして伝える', async () => {
    const { send, onError, post } = mount({
      loadEngine: vi.fn(async () => {
        throw new Error('not installed');
      }),
    });
    send({ type: 'ready' });
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toMatch(/not installed/);
  });

  it('差し替えられた後の通知では何もしない', async () => {
    const { send, post, container, onLoaded } = mount();
    container.innerHTML = '';
    send({ type: 'ready' });
    send({ type: 'loaded', pages: 1 });
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
  });
});
