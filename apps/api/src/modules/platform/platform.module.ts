import { Module } from '@nestjs/common';
import { type Env } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { ThrottlingModule } from '../../infra/throttling/throttling.module.js';
import { GSP_PROVIDER, type GspProvider } from './gsp/gsp-provider.js';
import { GstinController } from './gsp/gstin.controller.js';
import { MockGspProvider } from './gsp/mock-gsp.provider.js';
import { TenantBootstrapService } from './tenants/tenant-bootstrap.service.js';
import { TenantsService } from './tenants/tenants.service.js';

/** Adapter per `GSP_PROVIDER` value (ADR 0012); the record type forces one for every value. */
const GSP_ADAPTERS: Readonly<Record<Env['GSP_PROVIDER'], () => GspProvider>> = {
  mock: () => new MockGspProvider(),
};

const gspProviderFor = (env: Env): GspProvider => GSP_ADAPTERS[env.GSP_PROVIDER]();

/** Tenants, the tenant bootstrap and external platform integrations (GSP). */
@Module({
  imports: [ThrottlingModule],
  controllers: [GstinController],
  providers: [
    { provide: GSP_PROVIDER, inject: [ENV], useFactory: gspProviderFor },
    TenantsService,
    TenantBootstrapService,
  ],
  exports: [GSP_PROVIDER, TenantsService, TenantBootstrapService],
})
export class PlatformModule {}
