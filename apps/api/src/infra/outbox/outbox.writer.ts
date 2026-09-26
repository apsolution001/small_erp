import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type AppTransactionalAdapter } from '../db/app-db.js';
import { outboxMessageSchemas, type OutboxPayload, type OutboxTopic } from './outbox.messages.js';
import { outbox } from './outbox.schema.js';

/**
 * Records an external side effect in the current tenant transaction (ADR 0011). Nothing is sent
 * here: the row commits or rolls back with the change that caused it, and the relay delivers it.
 */
@Injectable()
export class OutboxWriter {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  /** Validates the payload against its topic and inserts it. Returns nothing: rows are write-only. */
  async enqueue<T extends OutboxTopic>(topic: T, payload: OutboxPayload<T>): Promise<void> {
    const parsed: unknown = outboxMessageSchemas[topic].parse(payload);
    // No RETURNING: ekaro_app has INSERT only on the outbox.
    await this.txHost.tx.insert(outbox).values({ topic, payload: parsed });
  }
}
