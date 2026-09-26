/**
 * Light / dark / system theme. The preference is a per-device UI setting (not server data), so
 * it lives in localStorage; the resolved theme is applied as the `dark` class on <html>.
 */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'ekaro.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const listeners = new Set<() => void>();

function isPreference(value: string | null): value is ThemePreference {
  return THEME_PREFERENCES.some((p) => p === value);
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function resolveTheme(pref: ThemePreference = preference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function apply(): void {
  document.documentElement.classList.toggle('dark', resolveTheme() === 'dark');
  for (const listener of listeners) listener();
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies to this page.
  }
  apply();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Applies the stored preference and follows OS changes while the preference is `system`. */
export function initTheme(): void {
  apply();
  if (typeof window.matchMedia === 'function') {
    window.matchMedia(DARK_QUERY).addEventListener('change', () => {
      if (preference === 'system') apply();
    });
  }
}
