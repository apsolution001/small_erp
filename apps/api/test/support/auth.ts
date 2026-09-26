import {
  type MeResponse,
  meResponseSchema,
  type Signup,
  type TokenResponse,
  tokenResponseSchema,
} from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type Response } from 'supertest';
import { refreshCookieName } from '../../src/modules/auth/sessions/refresh-cookie.js';
import { activeGstin } from '../factories/gstin.js';
import { TEST_PASSWORD, uniqueEmail } from '../factories/users.js';
import { http } from './app.js';
import { loadTestEnv } from './test-env.js';

/** The refresh cookie's name in e2e runs (Secure, so `__Secure-ekaro_refresh`). */
export const REFRESH_COOKIE = refreshCookieName(loadTestEnv());

/** A signed-up owner: the token response, the refresh cookie and the credentials. */
export interface SignedUp {
  readonly body: TokenResponse;
  readonly refreshToken: string;
  readonly email: string;
  readonly password: string;
  readonly gstin: string;
}

export function signupInput(overrides: Partial<Signup> = {}): Signup {
  return {
    fullName: 'Asha Mehta',
    email: uniqueEmail('owner'),
    mobile: '+919876543210',
    password: TEST_PASSWORD,
    gstin: activeGstin(),
    acceptTerms: true,
    ...overrides,
  };
}

/** The `Set-Cookie` line of the refresh cookie, or undefined. */
export function refreshSetCookie(res: Response): string | undefined {
  const header: unknown = res.headers['set-cookie'];
  const lines = Array.isArray(header) ? header.map(String) : [];
  return lines.find((line) => line.startsWith(`${REFRESH_COOKIE}=`));
}

/** The refresh token value set by a response (throws when none, or when it was cleared). */
export function refreshTokenOf(res: Response): string {
  const value = refreshSetCookie(res)
    ?.split(';')[0]
    ?.slice(REFRESH_COOKIE.length + 1);
  if (value === undefined || value === '') throw new Error('response set no refresh cookie');
  return value;
}

export const cookieHeader = (refreshToken: string): string => `${REFRESH_COOKIE}=${refreshToken}`;
export const bearer = (accessToken: string): string => `Bearer ${accessToken}`;

/** Signs up a new owner through the real endpoint and checks the response shape. */
export async function signUp(
  app: NestExpressApplication,
  overrides: Partial<Signup> = {},
): Promise<SignedUp> {
  const input = signupInput(overrides);
  const res = await http(app).post('/api/v1/auth/signup').send(input).expect(201);
  return {
    body: tokenResponseSchema.parse(res.body),
    refreshToken: refreshTokenOf(res),
    email: input.email,
    password: input.password,
    gstin: input.gstin,
  };
}

/** Logs in to one tenant (or the only one) and returns the token response and refresh token. */
export async function logIn(
  app: NestExpressApplication,
  email: string,
  password = TEST_PASSWORD,
  tenantId?: string,
): Promise<{ body: TokenResponse; refreshToken: string }> {
  const res = await http(app)
    .post('/api/v1/auth/login')
    .send({ email, password, ...(tenantId === undefined ? {} : { tenantId }) })
    .expect(200);
  return { body: tokenResponseSchema.parse(res.body), refreshToken: refreshTokenOf(res) };
}

export async function me(app: NestExpressApplication, accessToken: string): Promise<MeResponse> {
  const res = await http(app)
    .get('/api/v1/auth/me')
    .set('Authorization', bearer(accessToken))
    .expect(200);
  return meResponseSchema.parse(res.body);
}
