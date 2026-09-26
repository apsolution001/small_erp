import { type ReactNode, useEffect } from 'react';
import { HotkeysContext } from './hotkeys-context';
import { type HotkeyRegistry } from './registry';

/** Binds the registry to window keydown for the lifetime of the app. */
export function HotkeysProvider({
  registry,
  children,
}: {
  registry: HotkeyRegistry;
  children: ReactNode;
}) {
  useEffect(() => registry.attach(window), [registry]);
  return <HotkeysContext value={registry}>{children}</HotkeysContext>;
}
