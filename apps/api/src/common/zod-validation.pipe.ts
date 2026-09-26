import { Injectable, type PipeTransform } from '@nestjs/common';
import { type z } from 'zod';
import { ValidationError } from './errors/domain-error.js';

/**
 * Parses params, query or body with a contract schema from `@ekaro/contracts`:
 * `@Body(new ZodValidationPipe(createItemSchema)) body: CreateItem`.
 * Returns the parsed output (coerced, defaulted, unknown keys stripped) or throws a
 * {@link ValidationError}, which renders as a 400 problem with one entry per issue.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw ValidationError.fromZod(result.error);
    return result.data;
  }
}
