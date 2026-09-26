import { ServiceUnavailableException } from '@nestjs/common';
import { type HealthCheckResult, type HealthCheckService } from '@nestjs/terminus';
import { describe, expect, it } from 'vitest';
import { ServiceUnavailableError } from '../../common/errors/domain-error.js';
import { type DbHealthIndicator, type RedisHealthIndicator } from './health.indicators.js';
import { HealthController } from './health.controller.js';

const indicators = {
  db: { isHealthy: () => ({ db: { status: 'up' } }) } as unknown as DbHealthIndicator,
  redis: { isHealthy: () => ({ redis: { status: 'up' } }) } as unknown as RedisHealthIndicator,
};

function controllerWith(check: () => Promise<HealthCheckResult>): HealthController {
  const health = { check } as unknown as HealthCheckService;
  return new HealthController(health, indicators.db, indicators.redis);
}

describe('HealthController', () => {
  it('returns the terminus result when every dependency is up', async () => {
    const ok: HealthCheckResult = {
      status: 'ok',
      info: { db: { status: 'up' }, redis: { status: 'up' } },
      error: {},
      details: { db: { status: 'up' }, redis: { status: 'up' } },
    };
    await expect(controllerWith(() => Promise.resolve(ok)).check()).resolves.toEqual(ok);
  });

  it('turns a failed check into a 503 problem naming the failed dependencies', async () => {
    const failed: HealthCheckResult = {
      status: 'error',
      info: { db: { status: 'up' } },
      error: { redis: { status: 'down', message: 'ECONNREFUSED 10.0.0.9:6379' } },
      details: { db: { status: 'up' }, redis: { status: 'down' } },
    };
    const error = await controllerWith(() =>
      Promise.reject(new ServiceUnavailableException(failed)),
    )
      .check()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Unavailable: redis.',
    });
  });
});
