import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { type Request, type Response } from 'express';
import { ClsModule, type ClsService } from 'nestjs-cls';
import { APP_DB } from '../db/app-db.js';
import { DbModule } from '../db/db.module.js';
import { requestIdOf } from '../logging/request-id.js';
import { TenantContext } from './tenant-context.js';
import { TenantTxInterceptor } from './tenant-tx.interceptor.js';

/**
 * Request context (CLS) + transactions on the app connection (`TransactionHost`, default
 * connection) + the global `TenantTxInterceptor`.
 */
@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => requestIdOf(req),
        setup: (cls: ClsService, req: Request, _res: Response) => {
          cls.set('requestId', requestIdOf(req));
        },
      },
      plugins: [
        new ClsPluginTransactional({
          imports: [DbModule],
          adapter: new TransactionalAdapterDrizzleOrm({ drizzleInstanceToken: APP_DB }),
        }),
      ],
    }),
  ],
  providers: [TenantContext, { provide: APP_INTERCEPTOR, useClass: TenantTxInterceptor }],
  exports: [TenantContext],
})
export class TenancyModule {}
