import { describe, expect, it, vi } from 'vitest';
import { formatHotkey, formatKeys, HotkeyRegistry, matchesEvent } from './registry';

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

describe('matchesEvent', () => {
  it('maps mod to Ctrl, or ⌘ on macOS', () => {
    expect(matchesEvent('mod+k', key('k', { ctrlKey: true }), false)).toBe(true);
    expect(matchesEvent('mod+k', key('k', { metaKey: true }), false)).toBe(false);
    expect(matchesEvent('mod+k', key('k', { metaKey: true }), true)).toBe(true);
    expect(matchesEvent('mod+k', key('k'), false)).toBe(false);
  });

  it('needs the exact modifiers for letters, and ignores Shift on symbols like ?', () => {
    expect(matchesEvent('alt+n', key('n', { altKey: true }), false)).toBe(true);
    expect(matchesEvent('alt+n', key('N', { altKey: true, shiftKey: true }), false)).toBe(false);
    expect(matchesEvent('shift+?', key('?', { shiftKey: true }), false)).toBe(true);
    expect(matchesEvent('?', key('?', { shiftKey: true }), false)).toBe(true);
    expect(matchesEvent('escape', key('Escape'), false)).toBe(true);
    expect(matchesEvent('esc', key('Escape'), false)).toBe(true);
  });
});

describe('alternatives', () => {
  it('match and format each alternative', () => {
    expect(matchesEvent('pageup,pagedown', key('PageDown'), false)).toBe(true);
    expect(matchesEvent('pageup,pagedown', key('Home'), false)).toBe(false);
    expect(formatHotkey('arrowup,arrowdown', false)).toEqual([['↑'], ['↓']]);
  });
});

describe('formatKeys', () => {
  it('names keys the way the platform labels them', () => {
    expect(formatKeys('mod+k', false)).toEqual(['Ctrl', 'K']);
    expect(formatKeys('mod+k', true)).toEqual(['⌘', 'K']);
    expect(formatKeys('shift+?', false)).toEqual(['?']);
    expect(formatKeys('alt+arrowdown', false)).toEqual(['Alt', '↓']);
  });
});

describe('HotkeyRegistry', () => {
  it('runs the latest matching handler and prevents the browser default', () => {
    const registry = new HotkeyRegistry(false);
    const first = vi.fn();
    const second = vi.fn();
    registry.register({
      id: 'a',
      keys: 'mod+k',
      description: 'A',
      group: 'General',
      handler: first,
    });
    registry.register({
      id: 'b',
      keys: 'mod+k',
      description: 'B',
      group: 'General',
      handler: second,
    });
    const event = key('k', { ctrlKey: true });

    expect(registry.handleKeyDown(event)).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps bare keys out of text fields but lets modifier combos through', () => {
    const registry = new HotkeyRegistry(false);
    const help = vi.fn();
    const palette = vi.fn();
    registry.register({
      id: 'help',
      keys: '?',
      description: 'Help',
      group: 'General',
      handler: help,
    });
    registry.register({
      id: 'palette',
      keys: 'mod+k',
      description: 'Palette',
      group: 'General',
      handler: palette,
    });
    const input = document.createElement('input');
    document.body.append(input);

    registry.handleKeyDown(Object.defineProperty(key('?'), 'target', { value: input }));
    registry.handleKeyDown(
      Object.defineProperty(key('k', { ctrlKey: true }), 'target', { value: input }),
    );

    expect(help).not.toHaveBeenCalled();
    expect(palette).toHaveBeenCalledOnce();
    input.remove();
  });

  it('fires scoped shortcuts only for events inside the scope', () => {
    const registry = new HotkeyRegistry(false);
    const save = vi.fn();
    const form = document.createElement('form');
    const inside = document.createElement('input');
    form.append(inside);
    const outside = document.createElement('input');
    document.body.append(form, outside);
    registry.register({
      id: 'save',
      keys: 'mod+s',
      description: 'Save',
      group: 'Forms',
      handler: save,
      scope: () => form,
    });

    registry.handleKeyDown(
      Object.defineProperty(key('s', { ctrlKey: true }), 'target', { value: outside }),
    );
    expect(save).not.toHaveBeenCalled();
    registry.handleKeyDown(
      Object.defineProperty(key('s', { ctrlKey: true }), 'target', { value: inside }),
    );
    expect(save).toHaveBeenCalledOnce();
    form.remove();
    outside.remove();
  });

  it('lists entries (documentation-only ones too), replaces by id and unregisters', () => {
    const registry = new HotkeyRegistry(false);
    const listener = vi.fn();
    registry.subscribe(listener);
    const off = registry.register({ id: 'x', keys: 'enter', description: 'Open', group: 'Tables' });
    registry.register({ id: 'y', keys: '?', description: 'Help', group: 'General' });
    registry.register({ id: 'x', keys: 'enter', description: 'Open row', group: 'Tables' });

    expect(registry.list().map((h) => [h.id, h.description])).toEqual([
      ['y', 'Help'],
      ['x', 'Open row'],
    ]);
    // A documentation-only entry never handles the key.
    expect(registry.handleKeyDown(key('Enter'))).toBe(false);
    off(); // the replaced registration no longer exists: nothing to remove
    expect(registry.list()).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('attaches to window keydown', () => {
    const registry = new HotkeyRegistry(false);
    const handler = vi.fn();
    registry.register({ id: 'h', keys: '?', description: 'Help', group: 'General', handler });
    const detach = registry.attach(window);
    window.dispatchEvent(key('?', { shiftKey: true }));
    detach();
    window.dispatchEvent(key('?', { shiftKey: true }));
    expect(handler).toHaveBeenCalledOnce();
  });
});
