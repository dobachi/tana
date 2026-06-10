import { describe, it, expect, beforeEach } from 'vitest';
import { createInputDialog } from '../core/inputdialog.js';

describe('inputdialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('タイトルと既定値を表示する', () => {
    const ask = createInputDialog(document);
    ask('名前の変更', 'a.txt');
    expect(document.querySelector('.modal-label').textContent).toContain('名前の変更');
    expect(document.querySelector('.modal-input').value).toBe('a.txt');
  });

  it('OK で入力値を返し、閉じる', async () => {
    const ask = createInputDialog(document);
    const p = ask('名前', 'a.txt');
    document.querySelector('.modal-input').value = 'b.txt';
    document.querySelector('.modal-btn.primary').click();
    await expect(p).resolves.toBe('b.txt');
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('Enter で確定、Escape で null', async () => {
    const ask = createInputDialog(document);
    const p1 = ask('名前', 'x');
    document
      .querySelector('.modal-overlay')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(p1).resolves.toBe('x');

    const p2 = ask('名前', 'x');
    document
      .querySelector('.modal-overlay')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(p2).resolves.toBeNull();
  });

  it('キャンセルボタンで null', async () => {
    const ask = createInputDialog(document);
    const p = ask('名前', 'x');
    document.querySelectorAll('.modal-btn')[1].click();
    await expect(p).resolves.toBeNull();
  });

  it('doc が無ければ null', async () => {
    const ask = createInputDialog(null);
    await expect(ask('t', 'd')).resolves.toBeNull();
  });
});
