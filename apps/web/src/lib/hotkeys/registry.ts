/**
 * The shortcut registry (frontend standard: every shortcut is registered here and listed in the
 * `?` help dialog). Keys are written like `mod+k`, `shift+?`, `alt+n`, `escape`; `mod` is Ctrl,
 * or ⌘ on macOS.
 */
export const HOTKEY_GROUPS = ['General', 'Navigation', 'Forms', 'Tables'] as const;
export type HotkeyGroup = (typeof HOTKEY_GROUPS)[number];

export interface Hotkey {
  /** Stable id; registering the same id again replaces the earlier entry. */
  id: string;
  keys: string;
  description: string;
  group: HotkeyGroup;
  /**
   * Runs on a matching keydown. Without a handler the entry only documents a key handled by a
   * focused element (arrow keys in a table, Enter in a form).
   */
  handler?: (event: KeyboardEvent) => void;
  /**
   * Fire while focus is in a text field. Defaults to true for Ctrl/Alt/⌘ combinations and
   * false for bare keys, so typing `?` in a field never opens the help.
   */
  allowInInputs?: boolean;
  /** Fire only when the event comes from inside this element (a form, a dialog). */
  scope?: () => HTMLElement | null;
}

interface Combo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
};

export function parseKeys(keys: string): Combo {
  const parts = keys.toLowerCase().split('+');
  // `shift++` is not supported; a trailing empty part means the key itself was `+`.
  const rawKey = parts.at(-1) === '' ? '+' : (parts.at(-1) ?? '');
  const modifiers = new Set(parts.slice(0, -1));
  return {
    key: ALIASES[rawKey] ?? rawKey,
    mod: modifiers.has('mod'),
    ctrl: modifiers.has('ctrl'),
    alt: modifiers.has('alt'),
    shift: modifiers.has('shift'),
    meta: modifiers.has('meta'),
  };
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** A single symbol like `?` or `/` already implies (or ignores) Shift on the keyboard layout. */
function isSymbol(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/.test(key);
}

/** `keys` may list alternatives separated by commas: `arrowup,arrowdown`. */
export function splitAlternatives(keys: string): string[] {
  return keys.split(',').filter((k) => k !== '');
}

export function matchesEvent(keys: string, event: KeyboardEvent, isMac = isMacPlatform()): boolean {
  return splitAlternatives(keys).some((combo) => matchesCombo(combo, event, isMac));
}

function matchesCombo(keys: string, event: KeyboardEvent, isMac: boolean): boolean {
  const combo = parseKeys(keys);
  const wantCtrl = combo.ctrl || (combo.mod && !isMac);
  const wantMeta = combo.meta || (combo.mod && isMac);
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== combo.alt) {
    return false;
  }
  const key = event.key.toLowerCase();
  if (isSymbol(combo.key)) return key === combo.key;
  return key === combo.key && event.shiftKey === combo.shift;
}

/** Each alternative of `keys`, formatted: `arrowup,arrowdown` → `[['↑'], ['↓']]`. */
export function formatHotkey(keys: string, isMac = isMacPlatform()): string[][] {
  return splitAlternatives(keys).map((combo) => formatKeys(combo, isMac));
}

/** `mod+k` → `['Ctrl', 'K']` (`['⌘', 'K']` on macOS), for the help dialog and menus. */
export function formatKeys(keys: string, isMac = isMacPlatform()): string[] {
  const names: Readonly<Record<string, string>> = {
    mod: isMac ? '⌘' : 'Ctrl',
    ctrl: 'Ctrl',
    alt: isMac ? '⌥' : 'Alt',
    shift: 'Shift',
    meta: isMac ? '⌘' : 'Win',
    escape: 'Esc',
    esc: 'Esc',
    enter: 'Enter',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    up: '↑',
    down: '↓',
    pageup: 'PgUp',
    pagedown: 'PgDn',
    home: 'Home',
    end: 'End',
  };
  return keys
    .split('+')
    .filter((part, _i, all) => !(part === 'shift' && isSymbol(all.at(-1) ?? '')))
    .map((part) => names[part.toLowerCase()] ?? part.toUpperCase());
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export class HotkeyRegistry {
  private entries: Hotkey[] = [];
  private snapshot: readonly Hotkey[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly isMac = isMacPlatform()) {}

  register(hotkey: Hotkey): () => void {
    this.entries = [...this.entries.filter((e) => e.id !== hotkey.id), hotkey];
    this.changed();
    return () => {
      const before = this.entries.length;
      this.entries = this.entries.filter((e) => e !== hotkey);
      if (this.entries.length !== before) this.changed();
    };
  }

  /** Registered shortcuts in registration order (a stable snapshot for useSyncExternalStore). */
  list = (): readonly Hotkey[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Runs the most recently registered matching handler. Returns true when one ran. */
  handleKeyDown = (event: KeyboardEvent): boolean => {
    if (event.defaultPrevented || event.isComposing) return false;
    const inTextField = isTextField(event.target);
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry?.handler === undefined || !matchesEvent(entry.keys, event, this.isMac)) continue;
      const combo = parseKeys(splitAlternatives(entry.keys)[0] ?? '');
      const allowInInputs =
        entry.allowInInputs ?? (combo.mod || combo.ctrl || combo.alt || combo.meta);
      if (inTextField && !allowInInputs) continue;
      if (entry.scope) {
        const scope = entry.scope();
        if (!(scope && event.target instanceof Node && scope.contains(event.target))) continue;
      }
      event.preventDefault();
      entry.handler(event);
      return true;
    }
    return false;
  };

  attach(target: Window): () => void {
    target.addEventListener('keydown', this.handleKeyDown);
    return () => {
      target.removeEventListener('keydown', this.handleKeyDown);
    };
  }

  private changed(): void {
    this.snapshot = [...this.entries];
    for (const listener of this.listeners) listener();
  }
}
