import type { Theme } from '../shared/types';

/** Colour themes of the review page. Each id has a `:root[data-theme="…"]` block in review.css. */
export const THEMES = [
  { id: 'github-light', label: 'GitHub Light' },
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'ado-dark', label: 'Azure DevOps Dark' },
  { id: 'ado-light', label: 'Azure DevOps Light' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
/** `auto` follows GitHub's colour mode. */
export type ThemeChoice = 'auto' | ThemeId;

export const THEME_STORAGE_KEY = 'diffsanity.theme';

export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  return THEMES.some((theme) => theme.id === value) ? (value as ThemeId) : 'auto';
}

export function resolveThemeId(choice: ThemeChoice, githubTheme: Theme): ThemeId {
  return choice === 'auto' ? `github-${githubTheme}` : choice;
}

/**
 * The choice is kept in the extension origin's localStorage: it is shared by all review tabs,
 * readable synchronously (no flash of the wrong theme) and needs no extra permission.
 */
export function loadThemeChoice(storage: Pick<Storage, 'getItem'> = localStorage): ThemeChoice {
  try {
    return parseThemeChoice(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function saveThemeChoice(choice: ThemeChoice, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (choice === 'auto') storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be unavailable; the choice then only lasts for this tab.
  }
}
