import { type ModuleMetadata } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { type Env } from '../../src/config/env.js';
import { loadTestEnv } from './test-env.js';

export interface TestAppOptions {
  /** Extra modules, for example probe controllers that stand in for later features. */
  readonly imports?: ModuleMetadata['imports'];
  /** Environment overrides (for example `DB_POOL_MAX: 1` to force connection reuse). */
  readonly env?: Partial<Env>;
  /**
   * Provider replacements, for ports whose real adapter belongs to a later module (for example
   * `STOCK_POSTINGS` until the posting engine exists).
   */
  readonly providers?: readonly { readonly token: symbol; readonly useValue: unknown }[];
}

/** The real app (same module graph and HTTP pipeline as `main.ts`) on the test database. */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const env: Env = { ...loadTestEnv(), ...options.env };
  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(env), ...(options.imports ?? [])],
  });
  for (const { token, useValue } of options.providers ?? []) {
    builder = builder.overrideProvider(token).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, env);
  await app.init();
  return app;
}

/** supertest bound to the app's HTTP server. */
export function http(app: NestExpressApplication): ReturnType<typeof request> {
  return request(app.getHttpServer());
}
