import { describe, it, expect, beforeEach } from 'vitest';
import { createConflictDialog, CHOICE } from '../core/conflictdialog.js';

describe('conflictdialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('モーダルを表示し、ファイル名と提案名(入力欄の既定)を含む', () => {
    const ask = createConflictDialog(document);
    ask('photo.png', 'photo (1).png');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    expect(document.querySelector('.modal-msg').textContent).toContain('photo.png');
    const input = document.querySelector('.modal-input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('photo (1).png');
    expect(document.querySelectorAll('.modal-btn')).toHaveLength(3);
  });

  it('名前を変えて実行: 入力値を name として返す', async () => {
    const ask = createConflictDialog(document);
    const p = ask('a.txt', 'a (1).txt');
    const input = document.querySelector('.modal-input');
    input.value = 'custom.txt';
    document.querySelector('.modal-btn.primary').click();
    await expect(p).resolves.toEqual({ action: CHOICE.RENAME, name: 'custom.txt' });
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('上書きボタン → overwrite', async () => {
    const ask = createConflictDialog(document);
    const p = ask('a.txt', 'a (1).txt');
    document.querySelectorAll('.modal-btn')[1].click();
    await expect(p).resolves.toEqual({ action: CHOICE.OVERWRITE });
  });

  it('Enter で入力値の名前変更、Escape でキャンセル', async () => {
    const ask = createConflictDialog(document);
    const p1 = ask('a.txt', 'a (1).txt');
    document
      .querySelector('.modal-overlay')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(p1).resolves.toEqual({ action: CHOICE.RENAME, name: 'a (1).txt' });

    const p2 = ask('a.txt', 'a (1).txt');
    document
      .querySelector('.modal-overlay')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(p2).resolves.toEqual({ action: CHOICE.CANCEL });
  });

  it('body が無ければ cancel を返す', async () => {
    const ask = createConflictDialog(null);
    await expect(ask('x', 'x (1)')).resolves.toEqual({ action: CHOICE.CANCEL });
  });
});
