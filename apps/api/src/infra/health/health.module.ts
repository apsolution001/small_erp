import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DbModule } from '../db/db.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { HealthController } from './health.controller.js';
import { DbHealthIndicator, RedisHealthIndicator } from './health.indicators.js';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' }), DbModule, RedisModule],
  controllers: [HealthController],
  providers: [DbHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
