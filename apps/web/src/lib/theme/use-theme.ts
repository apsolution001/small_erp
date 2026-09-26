import { useSyncExternalStore } from 'react';
import {
  getThemePreference,
  resolveTheme,
  type ResolvedTheme,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from './theme-store';

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

export function useTheme(): ThemeState {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference);
  const resolved = useSyncExternalStore(subscribeTheme, () => resolveTheme());
  return { preference, resolved, setPreference: setThemePreference };
}
