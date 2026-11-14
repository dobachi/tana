import { describe, it, expect } from 'vitest';
import {
  KEYGUIDE_KEY,
  loadKeyGuide,
  storeKeyGuide,
  parsePrefixHint,
  keyGuideItems,
  keyGuideVisible,
} from '../core/keyguide.js';
import { PREFIX_LEADERS, resolvePrefixAction } from '../core/keyprefix.js';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

const keys = (r) => r.items.map((i) => i.key);

describe('キーガイドのオン/オフ保存', () => {
  it('既定はオフ', () => {
    expect(loadKeyGuide(memStorage())).toBe(false);
    expect(loadKeyGuide(null)).toBe(false);
  });

  it('保存した値を読み戻す', () => {
    const s = memStorage();
    storeKeyGuide(true, s);
    expect(s.getItem(KEYGUIDE_KEY)).toBe('on');
    expect(loadKeyGuide(s)).toBe(true);
    storeKeyGuide(false, s);
    expect(loadKeyGuide(s)).toBe(false);
  });

  it('storage が例外を投げても落ちない', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadKeyGuide(bad)).toBe(false);
    expect(() => storeKeyGuide(true, bad)).not.toThrow();
  });
});

describe('parsePrefixHint', () => {
  it('見出しと key=説明 の列に分ける', () => {
    expect(parsePrefixHint('タブ: h=左へ / l=右へ')).toEqual({
      title: 'タブ',
      items: [
        { key: 'h', label: '左へ' },
        { key: 'l', label: '右へ' },
      ],
    });
  });

  it('記号のキー（+ / - / 1-9）も扱う', () => {
    const r = parsePrefixHint('表示: +=大きく / -=小さく / 1-9=登録した外部アプリ');
    expect(r.items).toEqual([
      { key: '+', label: '大きく' },
      { key: '-', label: '小さく' },
      { key: '1-9', label: '登録した外部アプリ' },
    ]);
  });

  it('形の崩れた部分は飛ばす・空は空', () => {
    expect(parsePrefixHint('x: a=b / 壊れ / =c').items).toEqual([{ key: 'a', label: 'b' }]);
    expect(parsePrefixHint('')).toEqual({ title: '', items: [] });
    expect(parsePrefixHint(null)).toEqual({ title: '', items: [] });
  });
});

describe('keyGuideItems', () => {
  it('ペインでは主なキーと二打鍵の入口、すべてのキー(?) を出す', () => {
    const r = keyGuideItems({ focus: 'pane', safe: true });
    expect(keys(r)).toEqual(
      expect.arrayContaining(['Enter', 'Tab', '/', 'o', 'y', 's', 'f', 'v', 't', '?']),
    );
  });

  it('二打鍵の入口はすべてのリーダーを網羅する', () => {
    const r = keyGuideItems({});
    for (const leader of Object.keys(PREFIX_LEADERS)) expect(keys(r)).toContain(leader);
  });

  it('安全モードではファイル操作を出さず、操作モードへの切替を出す', () => {
    const r = keyGuideItems({ safe: true });
    expect(keys(r)).not.toContain('F5');
    expect(r.items.find((i) => i.key === 'Ctrl+Shift+Space').label).toBe('操作モードへ');
  });

  it('操作モードではファイル操作のキーを出す', () => {
    const r = keyGuideItems({ safe: false });
    expect(keys(r)).toEqual(expect.arrayContaining(['F5', 'F6', 'F2', 'F7', 'Del']));
    expect(r.items.find((i) => i.key === 'Ctrl+Shift+Space').label).toBe('安全モードへ');
  });

  it('二打鍵の途中はその続きのキーだけ（と Esc）を出す', () => {
    const r = keyGuideItems({ prefix: 'y' });
    expect(r.title).toBe('y → コピー');
    expect(keys(r)).toEqual(['p', 'n', 'd', 'Esc']);
  });

  it('二打鍵の続きとして出すキーは実際にアクションへ解決できる', () => {
    for (const leader of Object.keys(PREFIX_LEADERS)) {
      for (const { key } of keyGuideItems({ prefix: leader, wsl: true }).items) {
        if (key === 'Esc') continue;
        // 1-9 は範囲表記なので両端で確かめる
        const probes = key === '1-9' ? ['1', '9'] : [key];
        for (const k of probes)
          expect(resolvePrefixAction(leader, k), `${leader} → ${k}`).not.toBeNull();
      }
    }
  });

  it('WSL のときだけ o の続きに w / e を出す', () => {
    expect(keys(keyGuideItems({ prefix: 'o' }))).not.toContain('w');
    expect(keys(keyGuideItems({ prefix: 'o', wsl: true }))).toEqual(
      expect.arrayContaining(['w', 'e']),
    );
  });

  it('お気に入りの一覧ではお気に入りのキーを出す', () => {
    const r = keyGuideItems({ focus: 'favorites' });
    expect(r.title).toBe('お気に入り');
    expect(keys(r)).toContain('t');
    expect(keys(r)).not.toContain('o');
  });

  it('未知のプレフィックスはペインの表示に戻る', () => {
    expect(keyGuideItems({ prefix: 'z' }).title).toBe('');
  });
});

describe('index.html のキーガイド', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const html = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');

  it('既定は非表示で、項目の入れ物と閉じるボタンがある', () => {
    expect(html).toMatch(/<div id="keyguide"[^>]*\shidden[\s>]/);
    expect(html).toContain('class="keyguide-items"');
    expect(html).toContain('class="keyguide-close"');
  });
});

describe('keyGuideVisible', () => {
  it('オンなら常に出す', () => {
    expect(keyGuideVisible({ on: true })).toBe(true);
    expect(keyGuideVisible({ on: true, prefix: 'f' })).toBe(true);
  });

  it('オフでも二打鍵の途中（f 等を押した直後）は出す', () => {
    for (const leader of Object.keys(PREFIX_LEADERS)) {
      expect(keyGuideVisible({ on: false, prefix: leader })).toBe(true);
    }
  });

  it('オフで二打鍵の途中でなければ出さない', () => {
    expect(keyGuideVisible({ on: false, prefix: null })).toBe(false);
    expect(keyGuideVisible({ on: false, prefix: 'z' })).toBe(false);
    expect(keyGuideVisible()).toBe(false);
  });
});

describe('絞り込み中の案内', () => {
  it('絞り込み中は先頭に解除のキーを目立たせて出す', () => {
    const r = keyGuideItems({ filterActive: true });
    expect(r.items[0]).toEqual({ key: 'f → a', label: '絞り込みを解除', emphasis: true });
    // 案内しているキーは実際に解除へ解決できる
    expect(resolvePrefixAction('f', 'a')).toBe('filter:clear');
  });

  it('絞り込んでいなければ出さない', () => {
    expect(keyGuideItems({ filterActive: false }).items.some((i) => i.key === 'f → a')).toBe(false);
  });

  it('f を押した直後は絞り込みのサブコマンドを並べる', () => {
    const r = keyGuideItems({ prefix: 'f' });
    expect(r.title).toBe('f → 絞り込み');
    expect(r.items.map((i) => i.key)).toEqual(['d', 'f', 'i', 'e', 'a', 'Esc']);
  });
});
