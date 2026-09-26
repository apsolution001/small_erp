import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from './errors/domain-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({
  name: z.string().trim().min(1),
  pageSize: z.coerce.number().int().max(200).default(25),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed (coerced, defaulted, trimmed) value', () => {
    expect(pipe.transform({ name: '  Acme  ', extra: 'dropped' })).toEqual({
      name: 'Acme',
      pageSize: 25,
    });
    expect(pipe.transform({ name: 'Acme', pageSize: '50' })).toEqual({
      name: 'Acme',
      pageSize: 50,
    });
  });

  it('throws a ValidationError listing every issue with dotted paths', () => {
    let caught: unknown;
    try {
      pipe.transform({ name: '', pageSize: '500' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const error = caught as ValidationError;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors.map((e) => [e.path, e.code])).toEqual([
      ['name', 'too_small'],
      ['pageSize', 'too_big'],
    ]);
  });

  it('reports a non-object payload at the root path', () => {
    expect(() => pipe.transform(undefined)).toThrow(ValidationError);
    try {
      pipe.transform('nope');
    } catch (error) {
      expect((error as ValidationError).errors).toEqual([
        { path: '', message: expect.any(String) as string, code: 'invalid_type' },
      ]);
    }
  });
});
