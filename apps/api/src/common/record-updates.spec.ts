import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from './errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from './record-updates.js';

describe('assertVersion', () => {
  it('passes on the current version and is a 409 VERSION_CONFLICT otherwise', () => {
    expect(() => {
      assertVersion(3, 3);
    }).not.toThrow();
    try {
      assertVersion(4, 3);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    }
  });
});

describe('changesOf', () => {
  it('drops the version and keeps only the fields sent', () => {
    expect(changesOf({ name: 'Kilogram', version: 2 })).toEqual({ name: 'Kilogram' });
    expect(changesOf({ isActive: false, version: 7 })).toEqual({ isActive: false });
  });
});

describe('parseMergedRecord', () => {
  const record = z
    .object({ from: z.int(), to: z.int() })
    .refine((r) => r.to >= r.from, { path: ['to'], message: 'to before from' });

  it('returns the merged record when it satisfies the rules', () => {
    expect(parseMergedRecord(record, { from: 1, to: 5, id: 'x' }, { to: 9 })).toEqual({
      from: 1,
      to: 9,
    });
  });

  it('is a 422 with the path of the field a merged rule rejects', () => {
    try {
      parseMergedRecord(record, { from: 5, to: 9 }, { to: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).errors).toEqual([
        { path: 'to', message: 'to before from', code: 'custom' },
      ]);
    }
  });
});
