import { describe, it, expect, vi } from 'vitest';
import { createModalHeader } from '../core/modalheader.js';

describe('createModalHeader', () => {
  it('題名と × ボタンを並べ、× で onClose を呼ぶ', () => {
    const onClose = vi.fn();
    const head = createModalHeader(document, { title: '題', titleClass: 't', onClose });
    const h = head.querySelector('h2.t');
    expect(h.textContent).toBe('題');
    const x = head.querySelector('button.modal-close');
    expect(x.type).toBe('button');
    expect(x.getAttribute('aria-label')).toBe('閉じる');
    x.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
