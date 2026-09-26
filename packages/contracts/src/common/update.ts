import { z } from 'zod';
import { versionSchema } from './primitives.js';

const hasChange = (value: Record<string, unknown>): boolean =>
  Object.entries(value).some(([key, field]) => key !== 'version' && field !== undefined);

/**
 * A PATCH body: every field optional, no defaults, `version` required (optimistic locking) and
 * at least one field to change. Strict, so an unknown or immutable key is a 422. Cross-field
 * rules do not run here: the service parses the merged record with the entity's
 * `<entity>RecordSchema` (`xRecordSchema.parse({ ...existing, ...patch })`).
 */
export function updateSchema<Shape extends z.ZodRawShape>(fields: Shape) {
  return z
    .strictObject(fields)
    .partial()
    .extend({ version: versionSchema })
    .refine(hasChange, { message: 'Send at least one field to change' });
}
