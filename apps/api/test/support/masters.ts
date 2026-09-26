import { DEFAULT_ROLES, type Permission, problemSchema } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';
import { expect } from 'vitest';
import { addMembership, createTestUser } from '../factories/users.js';
import { http } from './app.js';
import { bearer, logIn, type SignedUp, signUp } from './auth.js';
import { withTenantConnection } from './db.js';

type Method = 'get' | 'post' | 'patch' | 'delete';

/** supertest calls as one signed-in user: `client.post('/units', body)`. Paths omit `/api/v1`. */
export interface ApiClient {
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
  patch(path: string, body?: object): request.Test;
  delete(path: string): request.Test;
}

export function apiClient(app: NestExpressApplication, accessToken: string): ApiClient {
  const call = (method: Method, path: string, body?: object): request.Test => {
    const req = http(app)[method](`/api/v1${path}`).set('Authorization', bearer(accessToken));
    return body === undefined ? req : req.send(body);
  };
  return {
    get: (path) => call('get', path),
    post: (path, body) => call('post', path, body),
    patch: (path, body) => call('patch', path, body),
    delete: (path) => call('delete', path),
  };
}

/** A tenant signed up through the API, with its owner's client. */
export interface TestTenant {
  readonly owner: SignedUp;
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly client: ApiClient;
  /** A client for a new user holding the named default role (created on first use). */
  as(roleName: string): Promise<ApiClient>;
}

export async function createTenant(app: NestExpressApplication): Promise<TestTenant> {
  const owner = await signUp(app);
  const tenantId = owner.body.tenant.id;
  const clients = new Map<string, ApiClient>();
  return {
    owner,
    tenantId,
    ownerUserId: owner.body.user.id,
    client: apiClient(app, owner.body.accessToken),
    async as(roleName) {
      const existing = clients.get(roleName);
      if (existing !== undefined) return existing;
      const user = await createTestUser({ fullName: `${roleName} User` });
      await addMembership(tenantId, user.id, roleName);
      const client = apiClient(app, (await logIn(app, user.email)).body.accessToken);
      clients.set(roleName, client);
      return client;
    },
  };
}

/**
 * A default role that holds `permission` (preferring a narrow one, Admin as the last resort) and
 * one that does not, straight from `DEFAULT_ROLES`, so permission tests follow the role matrix
 * as it changes. The Owner is never used: it holds everything by construction.
 */
export function rolesFor(permission: Permission): { allowed: string; denied: string } {
  const roles = DEFAULT_ROLES.filter((r) => !r.allPermissions);
  const narrowFirst = [
    ...roles.filter((r) => r.name !== 'Admin'),
    ...roles.filter((r) => r.name === 'Admin'),
  ];
  const allowed = narrowFirst.find((r) => r.permissions.includes(permission));
  const denied = roles.find((r) => !r.permissions.includes(permission));
  if (allowed === undefined || denied === undefined) {
    throw new Error(`No default role pair for ${permission}`);
  }
  return { allowed: allowed.name, denied: denied.name };
}

/** Asserts a problem+json response with the given status and code, and returns it. */
export function expectProblem(res: request.Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const problem = problemSchema.parse(res.body);
  expect(problem.code).toBe(code);
  return problem;
}

/** The dotted field paths of a 422 validation problem. */
export function errorPaths(res: request.Response): string[] {
  const problem = expectProblem(res, 422, 'VALIDATION_FAILED');
  return (problem.errors ?? []).map((e) => e.path);
}

export interface AuditRow {
  readonly action: string;
  readonly changedBy: string | null;
  readonly oldVersion: number | null;
  readonly newVersion: number | null;
}

/** The audit trail of one row, oldest first, read in the tenant's context. */
export async function auditTrail(
  tenantId: string,
  table: string,
  rowId: string,
): Promise<AuditRow[]> {
  return withTenantConnection(tenantId, async (c) => {
    const { rows } = await c.query<AuditRow>(
      `select action, changed_by as "changedBy",
              (old_data->>'version')::int as "oldVersion", (new_data->>'version')::int as "newVersion"
         from audit_log where table_name = $1 and row_id = $2 order by changed_at, id`,
      [table, rowId],
    );
    return rows;
  });
}
