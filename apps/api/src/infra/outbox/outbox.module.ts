import { Module } from '@nestjs/common';
import { OutboxWriter } from './outbox.writer.js';

/** The transactional outbox writer (ADR 0011). The relay worker is a separate process (later). */
@Module({ providers: [OutboxWriter], exports: [OutboxWriter] })
export class OutboxModule {}
