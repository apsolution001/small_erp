import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { type Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { ClockModule } from './infra/clock/clock.js';
import { HealthModule } from './infra/health/health.module.js';
import { buildLoggerParams } from './infra/logging/logger.options.js';
import { TenancyModule } from './infra/tenancy/tenancy.module.js';
import { AccessModule, PermissionGuard } from './modules/access/index.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard.js';
import { MastersModule } from './modules/masters/index.js';
import { PlatformModule } from './modules/platform/index.js';

/** Root module. Built from an already-validated {@link Env} so tests can pass their own. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot(buildLoggerParams(env)),
        ClockModule,
        TenancyModule,
        HealthModule,
        PlatformModule,
        AccessModule,
        AuthModule,
        MastersModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        // Global guards run in this order: authenticate, then authorize (deny by default).
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: PermissionGuard },
      ],
    };
  }
}
