import { describe, it, expect, beforeEach } from 'vitest';
import { createToast } from '../core/toast.js';

describe('toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('show でメッセージ要素を生成し表示する', () => {
    const toast = createToast(document);
    toast('テスト通知');
    const el = document.querySelector('.toast');
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('テスト通知');
    expect(el.classList.contains('show')).toBe(true);
    expect(el.getAttribute('role')).toBe('status');
  });

  it('複数回呼んでも要素は1つだけ', () => {
    const toast = createToast(document);
    toast('1回目');
    toast('2回目');
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    expect(document.querySelector('.toast').textContent).toBe('2回目');
  });

  it('body が無ければ何もしない', () => {
    const toast = createToast(null);
    expect(() => toast('x')).not.toThrow();
  });
});
