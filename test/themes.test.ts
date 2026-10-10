/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import css from '../styles/review.css?raw';
import {
  loadThemeChoice,
  parseThemeChoice,
  resolveThemeId,
  saveThemeChoice,
  THEME_STORAGE_KEY,
  THEMES,
} from '../src/review/themes';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe('themes', () => {
  it('follows GitHub in auto mode and uses the chosen theme otherwise', () => {
    expect(resolveThemeId('auto', 'light')).toBe('github-light');
    expect(resolveThemeId('auto', 'dark')).toBe('github-dark');
    expect(resolveThemeId('ado-dark', 'light')).toBe('ado-dark');
  });

  it('treats unknown or missing values as auto', () => {
    expect(parseThemeChoice('ado-light')).toBe('ado-light');
    expect(parseThemeChoice('dark')).toBe('auto');
    expect(parseThemeChoice(null)).toBe('auto');
  });

  it('remembers the choice, and forgets it when going back to auto', () => {
    const storage = memoryStorage();
    expect(loadThemeChoice(storage)).toBe('auto');
    saveThemeChoice('ado-dark', storage);
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('ado-dark');
    expect(loadThemeChoice(storage)).toBe('ado-dark');
    saveThemeChoice('auto', storage);
    expect(storage.values.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('survives unavailable storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    expect(loadThemeChoice(broken)).toBe('auto');
    expect(() => saveThemeChoice('ado-dark', broken)).not.toThrow();
  });

  it('has colours for every theme', () => {
    // GitHub Light is the :root default.
    for (const { id } of THEMES.filter((theme) => theme.id !== 'github-light')) {
      expect(css, id).toContain(`:root[data-theme="${id}"]`);
    }
  });
});
