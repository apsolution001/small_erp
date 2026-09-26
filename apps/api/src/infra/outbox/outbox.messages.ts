import { emailSchema, timestampSchema } from '@ekaro/contracts';
import { z } from 'zod';

/** Outbox topics (`outbox.topic`, a check constraint). */
export const OUTBOX_TOPICS = ['email.user_invitation'] as const;
export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];

/**
 * The payload schema of every topic. The writer validates on the way in and the relay (later)
 * parses on the way out, so both ends share one definition.
 */
export const outboxMessageSchemas = {
  /** Email: an invitation to join a company, with its one-time acceptance link. */
  'email.user_invitation': z.strictObject({
    to: emailSchema,
    invitationId: z.uuid(),
    companyName: z.string().min(1),
    roleName: z.string().min(1),
    invitedByName: z.string().min(1).nullable(),
    /** Carries the bearer token: never log it. */
    acceptUrl: z.url({ protocol: /^https?$/ }),
    expiresAt: timestampSchema,
  }),
} as const satisfies Record<OutboxTopic, z.ZodType>;

export type OutboxPayload<T extends OutboxTopic> = z.input<(typeof outboxMessageSchemas)[T]>;
