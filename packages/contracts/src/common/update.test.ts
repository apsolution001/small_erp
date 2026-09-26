import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import { updateSchema } from './update.js';

const schema = updateSchema({ name: z.string().min(1), note: z.string().nullable() });

describe('updateSchema', () => {
  it('accepts a partial change with a version and applies no defaults', () => {
    expect(schema.parse({ name: 'x', version: 2 })).toEqual({ name: 'x', version: 2 });
    expect(schema.parse({ note: null, version: 2 })).toEqual({ note: null, version: 2 });
  });

  it('requires a version', () => {
    expect(pathsOf(schema.safeParse({ name: 'x' }))).toEqual(['version']);
    expect(pathsOf(schema.safeParse({ name: 'x', version: 0 }))).toEqual(['version']);
  });

  it('rejects a body with nothing to change', () => {
    const onlyVersion = schema.safeParse({ version: 1 });
    expect(pathsOf(onlyVersion)).toEqual(['']);
    expect(onlyVersion.error?.issues[0]?.message).toBe('Send at least one field to change');
    expect(pathsOf(schema.safeParse({ name: undefined, version: 1 }))).toEqual(['']);
  });

  it('is strict: unknown and immutable keys are rejected', () => {
    expect(unrecognizedKeysOf(schema.safeParse({ name: 'x', id: 'y', version: 1 }))).toEqual([
      'id',
    ]);
  });

  it('validates each field it is given', () => {
    expect(pathsOf(schema.safeParse({ name: '', version: 1 }))).toEqual(['name']);
  });
});
