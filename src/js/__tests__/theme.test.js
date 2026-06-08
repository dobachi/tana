import { describe, it, expect } from 'vitest';
import { createTheme, THEMES, DEFAULT_THEME } from '../core/theme.js';

describe('theme', () => {
  it('既定はサイバーダーク', () => {
    const t = createTheme();
    expect(t.get()).toBe(DEFAULT_THEME);
    expect(DEFAULT_THEME).toBe('cyber-dark');
  });

  it('不正値は既定に丸める', () => {
    const t = createTheme('neon-pink');
    expect(t.get()).toBe(DEFAULT_THEME);
    expect(t.set('garbage')).toBe(DEFAULT_THEME);
  });

  it('toggle で 2テーマを循環する', () => {
    const t = createTheme('cyber-dark');
    expect(t.toggle()).toBe('light');
    expect(t.toggle()).toBe('cyber-dark');
  });

  it('登録済みテーマは cyber-dark と light のみ', () => {
    expect(THEMES).toEqual(['cyber-dark', 'light']);
  });

  it('set で指定テーマに切り替わる', () => {
    const t = createTheme();
    expect(t.set('light')).toBe('light');
  });
});
