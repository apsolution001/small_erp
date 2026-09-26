import { uuidSchema } from '@ekaro/contracts';
import { Param } from '@nestjs/common';
import { ZodValidationPipe } from '../zod-validation.pipe.js';

/**
 * A route's `:id` (or another named) path parameter, validated as a uuid. A malformed id is a
 * 422 before any query runs (Postgres would otherwise fail on the cast with a 500).
 */
export const IdParam = (name = 'id'): ParameterDecorator =>
  Param(name, new ZodValidationPipe(uuidSchema));
