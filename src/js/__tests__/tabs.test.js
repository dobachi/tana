import { describe, it, expect } from 'vitest';
import { createTabList } from '../core/tabs.js';

describe('createTabList', () => {
  it('初期は1タブでアクティブ', () => {
    const t = createTabList('/a');
    expect(t.count()).toBe(1);
    expect(t.activeIndex()).toBe(0);
    expect(t.active().dir).toBe('/a');
  });

  it('add はアクティブの直後に挿入し、それをアクティブにする', () => {
    const t = createTabList('/a');
    t.add('/b'); // [/a, /b] active=1
    t.activate(0);
    t.add('/c'); // [/a, /c, /b] active=1
    expect(t.list().map((x) => x.dir)).toEqual(['/a', '/c', '/b']);
    expect(t.activeIndex()).toBe(1);
    expect(t.active().dir).toBe('/c');
  });

  it('次/前はループする', () => {
    const t = createTabList('/a');
    t.add('/b');
    t.add('/c'); // active=2 (/c)
    expect(t.next()).toBe(0); // ループ
    expect(t.prev()).toBe(2);
  });

  it('アクティブより前を閉じると active が1つ減る', () => {
    const t = createTabList('/a');
    t.add('/b');
    t.add('/c'); // [/a,/b,/c] active=2
    t.close(0); // [/b,/c] active=1
    expect(t.list().map((x) => x.dir)).toEqual(['/b', '/c']);
    expect(t.active().dir).toBe('/c');
  });

  it('アクティブを閉じると隣（末尾なら手前）へ', () => {
    const t = createTabList('/a');
    t.add('/b');
    t.add('/c'); // active=2 (/c) 末尾
    t.close(2); // [/a,/b] active=1 (/b)
    expect(t.active().dir).toBe('/b');
    t.close(1); // [/a] active=0
    expect(t.active().dir).toBe('/a');
  });

  it('最後の1枚は閉じられない', () => {
    const t = createTabList('/a');
    expect(t.close()).toBe(false);
    expect(t.count()).toBe(1);
  });

  it('move: 先頭を末尾手前へ（insert-before セマンティクス）', () => {
    const t = createTabList('/a');
    t.add('/b');
    t.add('/c'); // [/a,/b,/c]
    t.move(0, 2); // /a を index2(/c) の手前へ → [/b,/a,/c]
    expect(t.list().map((x) => x.dir)).toEqual(['/b', '/a', '/c']);
  });

  it('move: 先頭を末尾へ', () => {
    const t = createTabList('/a');
    t.add('/b');
    t.add('/c');
    t.move(0, 3); // 末尾へ → [/b,/c,/a]
    expect(t.list().map((x) => x.dir)).toEqual(['/b', '/c', '/a']);
  });

  it('move: アクティブは同じタブを指し続ける', () => {
    const t = createTabList('/a');
    t.add('/b');
    t.add('/c');
    t.activate(1); // /b がアクティブ
    t.move(0, 3); // /a を末尾へ → [/b,/c,/a]、アクティブは /b(index0)
    expect(t.activeIndex()).toBe(0);
    expect(t.active().dir).toBe('/b');
  });

  it('move: 同じ位置は変化なし', () => {
    const t = createTabList('/a');
    t.add('/b'); // [/a,/b]
    t.move(0, 0);
    t.move(0, 1); // index0 の手前=元のまま
    expect(t.list().map((x) => x.dir)).toEqual(['/a', '/b']);
  });

  it('setActiveDir / setActiveState はアクティブに反映', () => {
    const t = createTabList('/a');
    t.add('/b');
    t.setActiveDir('/b2');
    t.setActiveState({ cursorPath: '/b2/x' });
    expect(t.active()).toEqual({ dir: '/b2', state: { cursorPath: '/b2/x' } });
    // 別タブは無変更
    t.activate(0);
    expect(t.active().dir).toBe('/a');
  });
});
