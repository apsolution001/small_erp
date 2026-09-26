import { describe, expect, it } from 'vitest';
import { describeBootFailure } from './bootstrap.js';
import { EnvValidationError } from './config/env.js';

describe('describeBootFailure', () => {
  it('prints an invalid configuration as a plain list, without a stack trace', () => {
    const text = describeBootFailure(
      new EnvValidationError([
        { variable: 'DATABASE_URL_APP', message: 'must be a postgres:// URL' },
        { variable: 'REDIS_URL', message: 'Invalid input: expected string, received undefined' },
      ]),
    );
    expect(text).toBe(
      [
        'Ekaro API failed to start.',
        'Invalid environment configuration:',
        '  - DATABASE_URL_APP: must be a postgres:// URL',
        '  - REDIS_URL: Invalid input: expected string, received undefined',
      ].join('\n'),
    );
  });

  it('keeps the stack for unexpected failures', () => {
    const error = new Error('listen EADDRINUSE: address already in use :::3000');
    expect(describeBootFailure(error)).toContain(error.stack);
    expect(describeBootFailure('odd')).toBe('Ekaro API failed to start.\nodd');
  });
});
