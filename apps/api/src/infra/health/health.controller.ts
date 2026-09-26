import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { ServiceUnavailableError } from '../../common/errors/domain-error.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { DbHealthIndicator, RedisHealthIndicator } from './health.indicators.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DbHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Liveness + readiness for load balancers and uptime probes: DB and Redis reachable. */
  @Get()
  // Justification: probes are unauthenticated, and the response reveals only up/down per dependency.
  @Public()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.db.isHealthy('db'),
        () => this.redis.isHealthy('redis'),
      ]);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      const result = error.getResponse() as Partial<HealthCheckResult>;
      const failed = Object.keys(result.error ?? {}).join(', ');
      // Error details (hosts, driver messages) are logged by terminus, never returned.
      throw new ServiceUnavailableError('HEALTH_CHECK_FAILED', `Unavailable: ${failed}.`, {
        cause: error,
      });
    }
  }
}
