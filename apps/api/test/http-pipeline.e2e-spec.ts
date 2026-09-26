import { problemSchema } from '@ekaro/contracts';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Public } from '../src/common/decorators/public.decorator.js';
import { ConflictError } from '../src/common/errors/domain-error.js';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe.js';
import { createTestApp, http } from './support/app.js';

const APP_ORIGIN = 'http://localhost:5173';
const createProbeSchema = z.object({ name: z.string().min(1), qty: z.number().int().positive() });

/** Stand-in routes that exercise the global pipeline (the real modules arrive with T-104+). */
@Controller('pipeline-probe')
class PipelineProbeController {
  @Post()
  // Justification: test-only probe of validation and error rendering.
  @Public()
  create(@Body(new ZodValidationPipe(createProbeSchema)) body: z.infer<typeof createProbeSchema>) {
    return { received: body };
  }

  @Get('conflict')
  @Public()
  conflict(): never {
    throw new ConflictError('EMAIL_TAKEN', 'This email is already registered.');
  }

  @Get('crash')
  @Public()
  crash(): never {
    throw new Error('connection to 10.1.2.3 failed: password authentication failed');
  }
}

@Module({ controllers: [PipelineProbeController] })
class PipelineProbeModule {}

const PROBLEM_JSON = /^application\/problem\+json; charset=utf-8$/;

describe('HTTP pipeline', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: [PipelineProbeModule], env: { APP_ORIGIN } });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('request id', () => {
    it('generates one when the client sends none, and returns it', async () => {
      const res = await http(app).get('/api/v1/health').expect(200);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('keeps a safe inbound x-request-id', async () => {
      const res = await http(app)
        .get('/api/v1/health')
        .set('x-request-id', 'lb-trace-42')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('lb-trace-42');
    });
  });

  describe('security headers and CORS', () => {
    it('sets helmet headers and hides the framework', async () => {
      const res = await http(app).get('/api/v1/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows the web origin with credentials and exposes the request id', async () => {
      const res = await http(app)
        .options('/api/v1/pipeline-probe')
        .set('Origin', APP_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      const get = await http(app).get('/api/v1/health').set('Origin', APP_ORIGIN).expect(200);
      expect(get.headers['access-control-expose-headers']).toBe('x-request-id');
    });

    it('does not allow any other origin', async () => {
      const res = await http(app).get('/api/v1/health').set('Origin', 'https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('errors as application/problem+json (RFC 9457)', () => {
    it('returns the parsed body when valid', async () => {
      const res = await http(app)
        .post('/api/v1/pipeline-probe')
        .send({ name: 'Bolt', qty: 3, extra: 'dropped' })
        .expect(201);
      expect(res.body).toEqual({ received: { name: 'Bolt', qty: 3 } });
    });

    it('renders validation failures as 400 with one entry per field', async () => {
      const res = await http(app)
        .post('/api/v1/pipeline-probe')
        .set('x-request-id', 'req-validation')
        .send({ name: '', qty: 1.5 })
        .expect(400);
      expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'The request is invalid.',
        errors: [
          { path: 'name', message: expect.any(String) as string, code: 'too_small' },
          { path: 'qty', message: expect.any(String) as string, code: 'invalid_type' },
        ],
        requestId: 'req-validation',
      });
    });

    it('renders malformed JSON as a 400 problem', async () => {
      const res = await http(app)
        .post('/api/v1/pipeline-probe')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);
      expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
      expect(res.body).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
    });

    it('renders domain errors with their status and stable code', async () => {
      const res = await http(app).get('/api/v1/pipeline-probe/conflict').expect(409);
      expect(res.body).toMatchObject({
        status: 409,
        code: 'EMAIL_TAKEN',
        detail: 'This email is already registered.',
      });
    });

    it('renders unknown routes as 404 NOT_FOUND', async () => {
      const res = await http(app).get('/api/v1/nope').expect(404);
      expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
      expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });

    it('hides the internals of unexpected errors', async () => {
      const res = await http(app).get('/api/v1/pipeline-probe/crash').expect(500);
      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        code: 'INTERNAL_ERROR',
        detail: 'An unexpected error occurred.',
        requestId: res.headers['x-request-id']!,
      });
      expect(JSON.stringify(res.body)).not.toContain('10.1.2.3');
    });

    it('produces bodies that satisfy the contracts problemSchema', async () => {
      const responses = await Promise.all([
        http(app).post('/api/v1/pipeline-probe').send({ name: '' }),
        http(app)
          .post('/api/v1/pipeline-probe')
          .set('Content-Type', 'application/json')
          .send('{"name": '),
        http(app).get('/api/v1/pipeline-probe/conflict'),
        http(app).get('/api/v1/nope'),
        http(app).get('/api/v1/pipeline-probe/crash'),
      ]);
      expect(responses.map((r) => r.status)).toEqual([400, 400, 409, 404, 500]);
      for (const res of responses) {
        expect(problemSchema.parse(res.body)).toEqual(res.body);
      }
    });
  });
});
