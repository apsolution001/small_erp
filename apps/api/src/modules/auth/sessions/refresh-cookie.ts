import { type CookieOptions, type Request, type Response } from 'express';
import { API_PREFIX } from '../../../app.constants.js';
import { type Env } from '../../../config/env.js';
import { type IssuedRefreshToken } from './session.service.js';

type CookieEnv = Pick<Env, 'REFRESH_COOKIE_SECURE'>;

/** The refresh token's cookie over plain http (local development only). */
export const REFRESH_COOKIE_DEV = 'ekaro_refresh';
/**
 * The refresh token's cookie whenever it is `Secure` (every deployed environment). Browsers accept
 * a `__Secure-` cookie only from https with `Secure` set, so a script on an http page of the same
 * site cannot plant or overwrite it.
 */
export const REFRESH_COOKIE_SECURE = `__Secure-${REFRESH_COOKIE_DEV}`;

/** Sent only to the auth routes, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

/** The cookie name for this environment (ADR 0016). */
export function refreshCookieName(env: CookieEnv): string {
  return env.REFRESH_COOKIE_SECURE ? REFRESH_COOKIE_SECURE : REFRESH_COOKIE_DEV;
}

function baseOptions(env: CookieEnv): CookieOptions {
  return {
    httpOnly: true,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, env: CookieEnv, refresh: IssuedRefreshToken): void {
  res.cookie(refreshCookieName(env), refresh.refreshToken, {
    ...baseOptions(env),
    expires: refresh.expiresAt,
  });
}

export function clearRefreshCookie(res: Response, env: CookieEnv): void {
  res.clearCookie(refreshCookieName(env), baseOptions(env));
}

/** The cookie value, when there is one (cookie-parser has run). */
export function readRefreshCookie(req: Request, env: CookieEnv): string | undefined {
  const cookies: unknown = req.cookies;
  const name = refreshCookieName(env);
  if (typeof cookies !== 'object' || cookies === null || !(name in cookies)) {
    return undefined;
  }
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
