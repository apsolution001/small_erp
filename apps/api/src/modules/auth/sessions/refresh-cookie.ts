import { type CookieOptions, type Request, type Response } from 'express';
import { API_PREFIX } from '../../../app.constants.js';
import { type Env } from '../../../config/env.js';
import { type IssuedRefreshToken } from './session.service.js';

/** The refresh token's cookie (ADR 0006, security standard). */
export const REFRESH_COOKIE = 'ekaro_refresh';
/** Sent only to the auth routes, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

function baseOptions(env: Pick<Env, 'REFRESH_COOKIE_SECURE'>): CookieOptions {
  return {
    httpOnly: true,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  res: Response,
  env: Pick<Env, 'REFRESH_COOKIE_SECURE'>,
  refresh: IssuedRefreshToken,
): void {
  res.cookie(REFRESH_COOKIE, refresh.refreshToken, {
    ...baseOptions(env),
    expires: refresh.expiresAt,
  });
}

export function clearRefreshCookie(res: Response, env: Pick<Env, 'REFRESH_COOKIE_SECURE'>): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(env));
}

/** The cookie value, when there is one (cookie-parser has run). */
export function readRefreshCookie(req: Request): string | undefined {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== 'object' || cookies === null || !(REFRESH_COOKIE in cookies)) {
    return undefined;
  }
  const value: unknown = (cookies as Record<string, unknown>)[REFRESH_COOKIE];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
