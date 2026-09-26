import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks the layout APIs Radix primitives call; these no-op stand-ins are enough for
// behaviour tests (nothing here measures layout).
class ResizeObserverStub {
  observe(): void {
    // no layout in jsdom
  }
  unobserve(): void {
    // no layout in jsdom
  }
  disconnect(): void {
    // no layout in jsdom
  }
}

function polyfill(target: object, name: string, value: unknown): void {
  if (!(name in target)) Object.defineProperty(target, name, { value, configurable: true });
}

polyfill(globalThis, 'ResizeObserver', ResizeObserverStub);
polyfill(Element.prototype, 'scrollIntoView', () => undefined);
polyfill(Element.prototype, 'hasPointerCapture', () => false);
polyfill(Element.prototype, 'releasePointerCapture', () => undefined);

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});
