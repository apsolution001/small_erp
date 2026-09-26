import { zodResolver } from '@hookform/resolvers/zod';
import { type FieldValues, type Path, type Resolver, type UseFormSetError } from 'react-hook-form';
import { type z } from 'zod';
import { errorMessage, isApiError } from './api-error';

/**
 * Plain-language messages for zod's generic issues in forms. A message written in a contracts
 * schema (`'Invalid GSTIN'`, `'Use at least 10 characters'`) always wins over these.
 */
export const formErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined || issue.input === '' ? 'Required' : undefined;
    case 'too_small':
      if (issue.origin !== 'string') return undefined;
      return Number(issue.minimum) <= 1
        ? 'Required'
        : `Use at least ${String(issue.minimum)} characters`;
    case 'too_big':
      return issue.origin === 'string'
        ? `Use at most ${String(issue.maximum)} characters`
        : undefined;
    case 'invalid_format':
      return issue.format === 'email' ? 'Enter a valid email address' : undefined;
    case 'invalid_value':
      return issue.values.length === 1 && issue.values[0] === true ? 'Required' : undefined;
    default:
      return undefined;
  }
};

/**
 * The react-hook-form resolver for a contracts schema (frontend standard: forms validate with
 * the same schema as the API), with {@link formErrorMap} messages.
 */
export function formResolver<Input extends FieldValues, Output>(
  schema: z.ZodType<Output, Input>,
): Resolver<Input, unknown, Output> {
  return zodResolver(schema, { error: formErrorMap });
}

/**
 * Puts server validation errors (`problem.errors`, frontend standard) on the matching fields.
 * Returns the message for the form-level alert: the error's own message when some of it could
 * not be shown on a field, otherwise null.
 */
export function applyServerErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: unknown,
  fields: readonly Path<T>[],
): string | null {
  if (!isApiError(error)) return errorMessage(error);
  const entries = Object.entries(error.fieldErrors);
  let unmatched = entries.length === 0;
  let focused = false;
  for (const [path, message] of entries) {
    const field = fields.find((f) => f === path);
    if (field === undefined) {
      unmatched = true;
      continue;
    }
    setError(field, { type: 'server', message }, { shouldFocus: !focused });
    focused = true;
  }
  return unmatched ? error.message : null;
}
