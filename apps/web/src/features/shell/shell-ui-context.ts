import { createContext, useContext } from 'react';

/** Overlays any part of the app can open: the command palette and the shortcuts help. */
export interface ShellUi {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

export const ShellUiContext = createContext<ShellUi | null>(null);

export function useShellUi(): ShellUi {
  const value = useContext(ShellUiContext);
  if (value === null) throw new Error('useShellUi must be used inside <ShellUiProvider>');
  return value;
}
