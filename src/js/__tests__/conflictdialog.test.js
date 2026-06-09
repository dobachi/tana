import { describe, it, expect, beforeEach } from 'vitest';
import { createConflictDialog, CHOICE } from '../core/conflictdialog.js';

describe('conflictdialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('モーダルを表示し、ファイル名を含む', async () => {
    const ask = createConflictDialog(document);
    ask('photo.png');
    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();
    expect(document.querySelector('.modal-msg').textContent).toContain('photo.png');
    expect(document.querySelectorAll('.modal-btn')).toHaveLength(3);
  });

  it('ボタンクリックで対応する選択を返し、モーダルを閉じる', async () => {
    const ask = createConflictDialog(document);
    const p = ask('a.txt');
    // 2番目=上書き
    document.querySelectorAll('.modal-btn')[1].click();
    await expect(p).resolves.toBe(CHOICE.OVERWRITE);
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('Escape でキャンセル', async () => {
    const ask = createConflictDialog(document);
    const p = ask('a.txt');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBe(CHOICE.CANCEL);
  });

  it('R/O/C キーで各選択', async () => {
    const dialog = createConflictDialog(document);
    const r = dialog('a');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await expect(r).resolves.toBe(CHOICE.RENAME);

    const o = dialog('a');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await expect(o).resolves.toBe(CHOICE.OVERWRITE);

    const c = dialog('a');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    await expect(c).resolves.toBe(CHOICE.CANCEL);
  });

  it('body が無ければ cancel を返す', async () => {
    const ask = createConflictDialog(null);
    await expect(ask('x')).resolves.toBe(CHOICE.CANCEL);
  });
});
