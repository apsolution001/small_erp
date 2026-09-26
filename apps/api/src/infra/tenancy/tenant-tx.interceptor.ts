import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { TenantContext } from './tenant-context.js';

/**
 * Wraps every request that has a tenant in its context (set by the JWT guard, which runs before
 * interceptors) in one DB transaction as `ekaro_app` with the tenant context applied. The
 * handler's result is resolved inside the transaction, which commits before the response is
 * sent; a thrown error rolls it back. Requests without a tenant (public, platform) pass through.
 */
@Injectable()
export class TenantTxInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || this.tenantContext.tenantId === undefined) {
      return next.handle();
    }
    return defer(() =>
      this.tenantContext.inTenantTransaction(() =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
