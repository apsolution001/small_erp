import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { uuidSchema } from './primitives.js';

describe('uuidSchema', () => {
  it('accepts uuidv7 and rejects garbage', () => {
    expect(uuidSchema.safeParse(uuidv7()).success).toBe(true);
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
