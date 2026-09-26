import { type ReactNode, useMemo, useState } from 'react';
import { useHotkey } from '@/lib/hotkeys';
import { HotkeysHelpDialog } from './hotkeys-help-dialog';
import { ShellUiContext } from './shell-ui-context';

/** Holds the overlay state and binds `?` to the shortcuts help, on every page. */
export function ShellUiProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const value = useMemo(
    () => ({ paletteOpen, setPaletteOpen, helpOpen, setHelpOpen }),
    [paletteOpen, helpOpen],
  );
  useHotkey({
    id: 'app.help',
    keys: 'shift+?',
    description: 'Show keyboard shortcuts',
    group: 'General',
    handler: () => {
      setHelpOpen(true);
    },
  });

  return (
    <ShellUiContext value={value}>
      {children}
      <HotkeysHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </ShellUiContext>
  );
}
