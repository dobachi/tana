import { describe, it, expect, vi } from 'vitest';
import { buildEditMenuItems } from '../core/editmenu.js';

const actions = {
  copy: vi.fn(),
  move: vi.fn(),
  rename: vi.fn(),
  trash: vi.fn(),
  deletePermanent: vi.fn(),
  makeFolder: vi.fn(),
};

/** ラベル前方一致で項目を引く（suffix 付きでも拾えるように） */
const find = (items, label) => items.find((i) => i.label && i.label.startsWith(label));

describe('buildEditMenuItems', () => {
  it('主要なファイル操作を並べる', () => {
    const items = buildEditMenuItems({ targetCount: 1, hasDest: true, hasCursor: true }, actions);
    const labels = items.filter((i) => i.label).map((i) => i.label);
    expect(labels).toEqual([
      '反対のペインへコピー',
      '反対のペインへ移動',
      '名前を変更…',
      'ゴミ箱へ',
      '完全に削除',
      '新しいフォルダ…',
    ]);
  });

  it('各項目に対応する action を割り当てる', () => {
    const items = buildEditMenuItems({ targetCount: 1, hasDest: true, hasCursor: true }, actions);
    expect(find(items, '反対のペインへコピー').action).toBe(actions.copy);
    expect(find(items, '反対のペインへ移動').action).toBe(actions.move);
    expect(find(items, '名前を変更…').action).toBe(actions.rename);
    expect(find(items, 'ゴミ箱へ').action).toBe(actions.trash);
    expect(find(items, '完全に削除').action).toBe(actions.deletePermanent);
    expect(find(items, '新しいフォルダ…').action).toBe(actions.makeFolder);
  });

  it('キーボードショートカットを表示する（メニューが学習の入口になる）', () => {
    const items = buildEditMenuItems({ targetCount: 1, hasDest: true, hasCursor: true }, actions);
    expect(find(items, '反対のペインへコピー').shortcut).toBe('F5');
    expect(find(items, '反対のペインへ移動').shortcut).toBe('F6');
    expect(find(items, '名前を変更…').shortcut).toBe('F2');
    expect(find(items, 'ゴミ箱へ').shortcut).toBe('Delete');
    expect(find(items, '完全に削除').shortcut).toBe('Shift+Delete');
    expect(find(items, '新しいフォルダ…').shortcut).toBe('F7');
  });

  describe('無効化', () => {
    it('対象があり宛先もあればコピー/移動は有効', () => {
      const items = buildEditMenuItems({ targetCount: 1, hasDest: true, hasCursor: true }, actions);
      expect(find(items, '反対のペインへコピー').disabled).toBe(false);
      expect(find(items, '反対のペインへ移動').disabled).toBe(false);
    });

    it('対象が無ければコピー/移動/削除は無効', () => {
      const items = buildEditMenuItems(
        { targetCount: 0, hasDest: true, hasCursor: false },
        actions,
      );
      expect(find(items, '反対のペインへコピー').disabled).toBe(true);
      expect(find(items, '反対のペインへ移動').disabled).toBe(true);
      expect(find(items, 'ゴミ箱へ').disabled).toBe(true);
      expect(find(items, '完全に削除').disabled).toBe(true);
    });

    it('宛先が無ければコピー/移動は無効（削除は宛先に依らない）', () => {
      const items = buildEditMenuItems(
        { targetCount: 1, hasDest: false, hasCursor: true },
        actions,
      );
      expect(find(items, '反対のペインへコピー').disabled).toBe(true);
      expect(find(items, '反対のペインへ移動').disabled).toBe(true);
      expect(find(items, 'ゴミ箱へ').disabled).toBe(false);
    });

    it('カーソル行が無ければ名前変更は無効', () => {
      const items = buildEditMenuItems(
        { targetCount: 2, hasDest: true, hasCursor: false },
        actions,
      );
      expect(find(items, '名前を変更…').disabled).toBe(true);
    });

    it('新しいフォルダは対象に依らず常に有効', () => {
      const items = buildEditMenuItems(
        { targetCount: 0, hasDest: false, hasCursor: false },
        actions,
      );
      expect(find(items, '新しいフォルダ…').disabled).toBeFalsy();
    });
  });

  describe('複数件のときの件数表示', () => {
    it('2件以上はラベルに件数を付ける', () => {
      const items = buildEditMenuItems({ targetCount: 3, hasDest: true, hasCursor: true }, actions);
      expect(find(items, '反対のペインへコピー').label).toBe('反対のペインへコピー（3 件）');
      expect(find(items, 'ゴミ箱へ').label).toBe('ゴミ箱へ（3 件）');
    });

    it('1件のときは件数を付けない', () => {
      const items = buildEditMenuItems({ targetCount: 1, hasDest: true, hasCursor: true }, actions);
      expect(find(items, '反対のペインへコピー').label).toBe('反対のペインへコピー');
    });

    it('名前変更は複数選択でも件数を付けない（対象は1つ）', () => {
      const items = buildEditMenuItems({ targetCount: 3, hasDest: true, hasCursor: true }, actions);
      expect(find(items, '名前を変更…').label).toBe('名前を変更…');
    });
  });

  it('削除項目は danger を立てる', () => {
    const items = buildEditMenuItems({ targetCount: 1, hasDest: true, hasCursor: true }, actions);
    expect(find(items, 'ゴミ箱へ').danger).toBe(true);
    expect(find(items, '完全に削除').danger).toBe(true);
    expect(find(items, '反対のペインへコピー').danger).toBeFalsy();
  });

  it('区切りを2つ挟む', () => {
    const items = buildEditMenuItems({ targetCount: 1, hasDest: true, hasCursor: true }, actions);
    expect(items.filter((i) => i.separator)).toHaveLength(2);
  });

  it('引数省略でも壊れない（全無効で返す）', () => {
    const items = buildEditMenuItems();
    expect(find(items, '反対のペインへコピー').disabled).toBe(true);
    expect(find(items, '名前を変更…').disabled).toBe(true);
  });
});
