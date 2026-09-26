import { uuidv7 } from '@ekaro/core';
import { Injectable, Logger } from '@nestjs/common';
import { Propagation, TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import { type AppTransactionalAdapter } from '../db/app-db.js';
import { type AfterCommitCallback, type RequestContext } from './request-context.js';
import { applyTransactionContext } from './transaction-context.js';

/**
 * Owns the tenant transaction (ADR 0003). Every tenant transaction starts with
 * `set_config('app.tenant_id' | 'app.user_id' | 'app.request_id', ..., true)`: the settings are
 * transaction-local, so a pooled connection can never carry one tenant's context into the next.
 */
@Injectable()
export class TenantContext {
  private readonly logger = new Logger(TenantContext.name);

  constructor(
    private readonly cls: ClsService<RequestContext>,
    private readonly txHost: TransactionHost<AppTransactionalAdapter>,
  ) {}

  get tenantId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('tenantId') : undefined;
  }

  get userId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('userId') : undefined;
  }

  get requestId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('requestId') : undefined;
  }

  /**
   * Runs `fn` in a transaction carrying the tenant of the current context (joins the current
   * transaction if there is one). Used by `TenantTxInterceptor` for authenticated requests.
   */
  async inTenantTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.tenantId === undefined) {
      throw new Error('inTenantTransaction() needs a tenant in the request context');
    }
    const run = () =>
      this.txHost.withTransaction(Propagation.Required, async () => {
        await this.applyContext();
        return fn();
      });
    // Joining an outer tenant transaction: its owner runs the after-commit callbacks.
    if (this.cls.get('afterCommit') !== undefined) return run();
    return this.withAfterCommit(run);
  }

  /**
   * Runs `fn` as `tenantId` (and `userId`, or no user for system jobs) in a new CLS context and
   * a new transaction, so it never joins or leaks into a surrounding one. For jobs and tests.
   */
  async runInTenant<T>(tenantId: string, userId: string | null, fn: () => Promise<T>): Promise<T> {
    return this.cls.run({ ifNested: 'inherit' }, async () => {
      this.cls.set('tenantId', tenantId);
      this.cls.set('userId', userId ?? undefined);
      this.cls.set('membershipId', undefined);
      if (!this.cls.has('requestId')) this.cls.set('requestId', uuidv7());
      return this.withAfterCommit(() =>
        this.txHost.withTransaction(Propagation.RequiresNew, async () => {
          await this.applyContext();
          return fn();
        }),
      );
    });
  }

  /**
   * Runs `callback` once the current tenant transaction has committed, and never after a rollback.
   * For effects outside the database that must not see (or race) uncommitted state, such as
   * dropping a cache entry that a concurrent request could otherwise refill with the old value.
   * A failing callback is logged, not thrown: the change itself is already committed.
   */
  afterCommit(callback: AfterCommitCallback): void {
    const queue = this.cls.isActive() ? this.cls.get('afterCommit') : undefined;
    if (queue === undefined) throw new Error('afterCommit() needs a tenant transaction');
    queue.push(callback);
  }

  private async withAfterCommit<T>(transaction: () => Promise<T>): Promise<T> {
    const queue: AfterCommitCallback[] = [];
    this.cls.set('afterCommit', queue);
    let result: T;
    try {
      result = await transaction();
    } finally {
      this.cls.set('afterCommit', undefined);
    }
    for (const callback of queue) {
      try {
        await callback();
      } catch (err) {
        this.logger.warn({ err }, 'After-commit callback failed');
      }
    }
    return result;
  }

  private async applyContext(): Promise<void> {
    await applyTransactionContext(this.txHost.tx, {
      tenantId: this.tenantId,
      userId: this.userId,
      requestId: this.requestId,
    });
  }
}
