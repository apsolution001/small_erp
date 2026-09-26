import { ClsServiceManager } from 'nestjs-cls';
import { type Params } from 'nestjs-pino';
import { type LoggerOptions } from 'pino';
import { HEALTH_PATH } from '../../app.constants.js';
import { type Env } from '../../config/env.js';
import { type RequestContext } from '../tenancy/request-context.js';
import { requestIdOf } from './request-id.js';

type LoggerEnv = Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>;

/**
 * Keys whose values never reach the logs, at any of the first three nesting levels. Request and
 * response bodies are not logged at all (pino-http's default serializers omit them); this list
 * also covers objects that code logs explicitly.
 */
const SENSITIVE_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'selectionToken',
  'otp',
  'totp',
  'totpCode',
  'totpSecret',
  'recoveryCodes',
  'secret',
  'apiKey',
] as const;

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

/** Adds the tenant and user of the current CLS context to every log line. */
function contextFields(): Record<string, string> {
  const cls = ClsServiceManager.getClsService<RequestContext>();
  if (!cls.isActive()) return {};
  const fields: Record<string, string> = {};
  const tenantId = cls.get('tenantId');
  const userId = cls.get('userId');
  if (tenantId !== undefined) fields.tenantId = tenantId;
  if (userId !== undefined) fields.userId = userId;
  return fields;
}

/** Base Pino options (also used directly by tests and, later, the worker). */
export function loggerOptions(env: LoggerEnv): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    mixin: contextFields,
  };
}

/** nestjs-pino configuration: structured JSON, request id, redaction, quiet health checks. */
export function buildLoggerParams(env: LoggerEnv): Params {
  return {
    pinoHttp: {
      ...loggerOptions(env),
      genReqId: (req) => requestIdOf(req),
      // Logs written while handling a request carry `requestId` (not the whole `req` object);
      // the one "request completed" line per request keeps the full req/res.
      quietReqLogger: true,
      customAttributeKeys: { reqId: 'requestId' },
      autoLogging: { ignore: (req) => req.url?.startsWith(HEALTH_PATH) === true },
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    },
  };
}
