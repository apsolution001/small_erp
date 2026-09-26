import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, http } from './support/app.js';

describe('GET /api/v1/health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database and Redis as up, without authentication', async () => {
    const res = await http(app).get('/api/v1/health').expect(200);
    const up = { status: 'up', responseTime: expect.any(Number) as number };
    expect(res.body).toEqual({
      status: 'ok',
      info: { db: up, redis: up },
      error: {},
      details: { db: up, redis: up },
    });
  });

  it('is only served under the /api/v1 prefix', async () => {
    await http(app).get('/health').expect(404);
  });
});
