import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { type Hotkey, type HotkeyRegistry } from './registry';

export const HotkeysContext = createContext<HotkeyRegistry | null>(null);

export function useHotkeyRegistry(): HotkeyRegistry {
  const registry = useContext(HotkeysContext);
  if (registry === null) throw new Error('Hotkeys must be used inside <HotkeysProvider>');
  return registry;
}

export function useHotkeyList(): readonly Hotkey[] {
  const registry = useHotkeyRegistry();
  return useSyncExternalStore(registry.subscribe, registry.list);
}

export type UseHotkeyOptions = Omit<Hotkey, 'handler' | 'scope'> & {
  handler?: (event: KeyboardEvent) => void;
  scope?: () => HTMLElement | null;
  /** Default true. A disabled shortcut is neither bound nor listed. */
  enabled?: boolean;
};

/** Registers a shortcut while the component is mounted. The latest handler always runs. */
export function useHotkey(options: UseHotkeyOptions): void {
  const registry = useHotkeyRegistry();
  const handlerRef = useRef(options.handler);
  const scopeRef = useRef(options.scope);
  useLayoutEffect(() => {
    handlerRef.current = options.handler;
    scopeRef.current = options.scope;
  });

  const { id, keys, description, group, allowInInputs, enabled = true } = options;
  const hasHandler = options.handler !== undefined;
  const hasScope = options.scope !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;
    const hotkey: Hotkey = { id, keys, description, group };
    if (allowInInputs !== undefined) hotkey.allowInInputs = allowInInputs;
    if (hasHandler) hotkey.handler = (event) => handlerRef.current?.(event);
    if (hasScope) hotkey.scope = () => scopeRef.current?.() ?? null;
    return registry.register(hotkey);
  }, [registry, id, keys, description, group, allowInInputs, enabled, hasHandler, hasScope]);
}
