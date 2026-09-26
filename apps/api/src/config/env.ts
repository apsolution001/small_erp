import { z } from 'zod';

/**
 * The single place that reads `process.env` (docs/standards/backend.md).
 * Everything else receives the parsed, typed {@link Env} through DI (`ENV` token).
 */

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' });
const redisUrl = z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' });
const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();

const EXAMPLE_SECRET_PREFIX = 'change-me';
/** GSP adapters that answer without a real GST portal: refused in production. */
const TEST_ONLY_GSP_PROVIDERS: ReadonlySet<string> = new Set(['mock']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.default(3000),
    /** The web origin allowed by CORS (with credentials). */
    APP_ORIGIN: z.url({ protocol: /^https?$/ }),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /** Migrations only (ekaro_owner). The API process never needs it, so it is optional here. */
    DATABASE_URL_OWNER: postgresUrl.optional(),
    /** Tenant work, RLS enforced (ekaro_app). */
    DATABASE_URL_APP: postgresUrl,
    /** Platform tables, restricted to modules/platform and modules/auth (ekaro_platform). */
    DATABASE_URL_PLATFORM: postgresUrl,
    DB_POOL_MAX: positiveInt.max(100).default(10),

    REDIS_URL: redisUrl,

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: positiveInt.default(900),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    /**
     * Idle session lifetime: a refresh token expires this long after it was issued, so a session
     * unused for this long ends. Rotation never extends a session past its absolute lifetime.
     */
    SESSION_IDLE_DAYS: positiveInt.max(365).default(7),
    /** Absolute session lifetime from login (ADR 0016): the user must sign in again after it. */
    SESSION_ABSOLUTE_DAYS: positiveInt.max(365).default(30),
    /**
     * `Secure` flag of the refresh cookie. Browsers drop Secure cookies over plain http, so local
     * development over http sets it to false. Always true in production.
     */
    REFRESH_COOKIE_SECURE: z.stringbool().default(true),
    /** 32-byte key, base64, for encrypting TOTP secrets (AES-256-GCM). */
    DATA_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
      error: 'must be base64 that decodes to exactly 32 bytes',
    }),

    /** GST Suvidha Provider adapter. `mock` is refused in production. */
    GSP_PROVIDER: z.enum(['mock']),

    /**
     * Reverse proxies in front of the API (Express `trust proxy` hop count). The client IP used for
     * rate limiting is taken this many hops back in `X-Forwarded-For`; 0 means the socket address.
     * Defaults to 0, but production must set it explicitly (a wrong value breaks rate limiting).
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),
    /** Requests per minute per client IP on each auth route (security standard). */
    THROTTLE_AUTH_PER_MINUTE: positiveInt.default(20),
    /** Login and signup attempts per minute per email address. */
    THROTTLE_ACCOUNT_PER_MINUTE: positiveInt.default(10),
    /** GSTIN lookups per minute per client IP (spec 01 §3.1). */
    THROTTLE_GSTIN_PER_MINUTE: positiveInt.default(10),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: port,
    MAIL_FROM: z.string().min(3),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.startsWith(EXAMPLE_SECRET_PREFIX)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'the example secret must not be used in production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.REFRESH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    // The mock answers any well-formed GSTIN as a registered business: never in production.
    if (env.NODE_ENV === 'production' && TEST_ONLY_GSP_PROVIDERS.has(env.GSP_PROVIDER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GSP_PROVIDER'],
        message: 'the mock GSP must not be used in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY_HOPS'],
        message: 'must be set explicitly in production (the number of proxies in front of the API)',
      });
    }
    if (env.SESSION_IDLE_DAYS > env.SESSION_ABSOLUTE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_IDLE_DAYS'],
        message: 'must not exceed SESSION_ABSOLUTE_DAYS',
      });
    }
  })
  .transform((env) => ({ ...env, TRUST_PROXY_HOPS: env.TRUST_PROXY_HOPS ?? 0 }));

export type Env = z.output<typeof envSchema>;
export type RawEnv = Readonly<Record<string, string | undefined>>;

export interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

/** Boot-time configuration error. Its message is meant to be printed as-is (no values, no stack). */
export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';

  constructor(readonly issues: readonly EnvIssue[]) {
    super(
      [
        'Invalid environment configuration:',
        ...issues.map((issue) => `  - ${issue.variable}: ${issue.message}`),
      ].join('\n'),
    );
  }
}

function parseWith<T>(schema: z.ZodType<T>, raw: RawEnv): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new EnvValidationError(
    result.error.issues.map((issue) => {
      const variable = issue.path.map(String).join('.') || '(root)';
      // Zod reports a missing number as NaN after coercion; name the real problem instead.
      const missing = issue.path.length === 1 && raw[variable] === undefined;
      return { variable, message: missing ? 'is required' : issue.message };
    }),
  );
}

/** Parses a raw environment. Throws {@link EnvValidationError} listing every invalid variable. */
export function parseEnv(raw: RawEnv): Env {
  return parseWith(envSchema, raw);
}

/** Parses the process environment for the API. */
export function loadEnv(): Env {
  return parseEnv(process.env);
}

const migrationEnvSchema = z.object({ DATABASE_URL_OWNER: postgresUrl });
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

/** The migration runner needs only the owner connection. */
export function parseMigrationEnv(raw: RawEnv): MigrationEnv {
  return parseWith(migrationEnvSchema, raw);
}

/** Parses the process environment for the migration runner. */
export function loadMigrationEnv(): MigrationEnv {
  return parseMigrationEnv(process.env);
}
