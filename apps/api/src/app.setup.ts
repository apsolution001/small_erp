import { type NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_PREFIX } from './app.constants.js';
import { type Env } from './config/env.js';
import { REQUEST_ID_HEADER, requestIdMiddleware } from './infra/logging/request-id.js';

/**
 * HTTP pipeline shared by `main.ts` and the e2e app factory, so tests exercise the real one.
 * Order matters: the request id comes first so every later log line and error carries it.
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({
    // An allow-list (not a bare string): other origins get no Access-Control-Allow-Origin at all.
    origin: [env.APP_ORIGIN],
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
}
