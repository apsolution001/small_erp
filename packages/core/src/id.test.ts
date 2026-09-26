import { describe, expect, it } from 'vitest';
import { uuidv7 } from './id.js';

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 ids', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is monotonically increasing when generated in sequence', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());
    expect([...ids].sort()).toEqual(ids);
  });
});
