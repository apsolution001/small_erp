import { Writable } from 'node:stream';
import { ClsServiceManager } from 'nestjs-cls';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { type Env } from '../../config/env.js';
import { buildLoggerParams, loggerOptions } from './logger.options.js';

function capture(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { logger: pino(loggerOptions(env), stream), lines };
}

describe('logger options', () => {
  it('redacts credentials in headers and in nested payloads', () => {
    const { logger, lines } = capture({ LOG_LEVEL: 'info', NODE_ENV: 'production' });
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'rt=xyz', accept: 'json' } },
        res: { headers: { 'set-cookie': 'rt=new' } },
        password: 'p1',
        body: { password: 'p2', refreshToken: 'r1', user: { passwordHash: 'h', otp: '123456' } },
      },
      'login',
    );
    const text = JSON.stringify(lines[0]);
    for (const secret of ['Bearer abc', 'rt=xyz', 'rt=new', 'p1', 'p2', 'r1', '"h"', '123456']) {
      expect(text).not.toContain(secret);
    }
    expect(lines[0]).toMatchObject({
      req: { headers: { authorization: '[REDACTED]', cookie: '[REDACTED]', accept: 'json' } },
      body: { password: '[REDACTED]', user: { passwordHash: '[REDACTED]', otp: '[REDACTED]' } },
    });
  });

  it('adds tenantId and userId from the request context when present', () => {
    const { logger, lines } = capture({ LOG_LEVEL: 'info', NODE_ENV: 'production' });
    const cls = ClsServiceManager.getClsService();
    cls.run(() => {
      cls.set('tenantId', 't-1');
      cls.set('userId', 'u-1');
      logger.info('inside');
    });
    logger.info('outside');
    expect(lines[0]).toMatchObject({ tenantId: 't-1', userId: 'u-1', msg: 'inside' });
    expect(lines[1]).not.toHaveProperty('tenantId');
  });

  it('honours LOG_LEVEL and pretty-prints only in development', () => {
    const prod = buildLoggerParams({ LOG_LEVEL: 'warn', NODE_ENV: 'production' });
    const dev = buildLoggerParams({ LOG_LEVEL: 'debug', NODE_ENV: 'development' });
    expect(prod.pinoHttp).toMatchObject({
      level: 'warn',
      quietReqLogger: true,
      customAttributeKeys: { reqId: 'requestId' },
    });
    expect(prod.pinoHttp).not.toHaveProperty('transport');
    expect(dev.pinoHttp).toMatchObject({ level: 'debug', transport: { target: 'pino-pretty' } });
  });
});
