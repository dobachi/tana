import { describe, it, expect } from 'vitest';
import { createPanes, PANE } from '../core/panes.js';

describe('panes', () => {
  it('既定は左ペインがアクティブ', () => {
    const p = createPanes();
    expect(p.getActive()).toBe(PANE.LEFT);
    expect(p.getInactive()).toBe(PANE.RIGHT);
  });

  it('toggle で左右が入れ替わる', () => {
    const p = createPanes();
    expect(p.toggle()).toBe(PANE.RIGHT);
    expect(p.getInactive()).toBe(PANE.LEFT);
    expect(p.toggle()).toBe(PANE.LEFT);
  });

  it('setActive で明示設定できる', () => {
    const p = createPanes();
    expect(p.setActive(PANE.RIGHT)).toBe(PANE.RIGHT);
    expect(p.setActive('garbage')).toBe(PANE.LEFT);
  });
});
