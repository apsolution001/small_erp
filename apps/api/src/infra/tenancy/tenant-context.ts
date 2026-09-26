import { uuidv7 } from '@ekaro/core';
import { Injectable } from '@nestjs/common';
import { Propagation, TransactionHost } from '@nestjs-cls/transactional';
import { sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { type AppTransactionalAdapter } from '../db/app-db.js';
import { type RequestContext } from './request-context.js';

/**
 * Owns the tenant transaction (ADR 0003). Every tenant transaction starts with
 * `set_config('app.tenant_id' | 'app.user_id' | 'app.request_id', ..., true)`: the settings are
 * transaction-local, so a pooled connection can never carry one tenant's context into the next.
 */
@Injectable()
export class TenantContext {
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
    return this.txHost.withTransaction(Propagation.Required, async () => {
      await this.applyContext();
      return fn();
    });
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
      return this.txHost.withTransaction(Propagation.RequiresNew, async () => {
        await this.applyContext();
        return fn();
      });
    });
  }

  private async applyContext(): Promise<void> {
    await this.txHost.tx.execute(sql`select
      set_config('app.tenant_id', ${this.tenantId ?? ''}, true),
      set_config('app.user_id', ${this.userId ?? ''}, true),
      set_config('app.request_id', ${this.requestId ?? ''}, true)`);
  }
}
