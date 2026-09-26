import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { type Env, EnvValidationError, loadEnv } from './config/env.js';

/** Builds the configured (not yet listening) application. */
export async function createApp(env: Env): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
  });
  configureApp(app, env);
  return app;
}

/**
 * Validates the environment first (so a bad config fails before any connection is opened),
 * then starts listening. SIGTERM/SIGINT drain in-flight requests, then close the pools and Redis.
 */
export async function bootstrap(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await createApp(env);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  return app;
}

/** What to print when boot fails: config errors as a plain list, anything else with its stack. */
export function describeBootFailure(error: unknown): string {
  if (error instanceof EnvValidationError) return `Ekaro API failed to start.\n${error.message}`;
  if (error instanceof Error) return `Ekaro API failed to start.\n${error.stack ?? error.message}`;
  return `Ekaro API failed to start.\n${String(error)}`;
}
