import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { type Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { HealthModule } from './infra/health/health.module.js';
import { buildLoggerParams } from './infra/logging/logger.options.js';
import { TenancyModule } from './infra/tenancy/tenancy.module.js';

/** Root module. Built from an already-validated {@link Env} so tests can pass their own. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot(buildLoggerParams(env)),
        TenancyModule,
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
    };
  }
}
