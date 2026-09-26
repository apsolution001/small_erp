import { roleResponseSchema, type RoleResponse } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { z } from 'zod';
import { outboxMessageSchemas } from '../../src/infra/outbox/outbox.messages.js';
import { addMembership, createTestUser, type MembershipOptions } from '../factories/users.js';
import { http } from './app.js';
import { bearer, logIn } from './auth.js';
import { withOwnerClient, withTenantConnection } from './db.js';

/** A signed-in member of a tenant with one of its roles. */
export interface Member {
  readonly userId: string;
  readonly email: string;
  readonly membershipId: string;
  readonly token: string;
}

/** Creates a user with a membership (raw, as a fixture) and signs them in to that tenant. */
export async function memberWithRole(
  app: NestExpressApplication,
  tenantId: string,
  roleName: string,
  options: MembershipOptions & { fullName?: string } = {},
): Promise<Member> {
  const user = await createTestUser({ fullName: options.fullName ?? `${roleName} User` });
  const membershipId = await addMembership(tenantId, user.id, roleName, options);
  const session = await logIn(app, user.email, undefined, tenantId);
  return { userId: user.id, email: user.email, membershipId, token: session.body.accessToken };
}

/** A role of the caller's tenant by exact name, through the API. */
export async function roleNamed(
  app: NestExpressApplication,
  token: string,
  name: string,
): Promise<RoleResponse> {
  const res = await http(app)
    .get('/api/v1/roles')
    .query({ q: name, pageSize: 200 })
    .set('Authorization', bearer(token))
    .expect(200);
  const roles = z.object({ data: z.array(roleResponseSchema) }).parse(res.body).data;
  const role = roles.find((r) => r.name === name);
  if (role === undefined) throw new Error(`No role "${name}"`);
  return role;
}

export const HEAD_OFFICE_SQL = 'select id from branches where is_head_office';

export async function headOfficeId(tenantId: string): Promise<string> {
  const rows = await withTenantConnection(
    tenantId,
    async (c) => (await c.query<{ id: string }>(HEAD_OFFICE_SQL)).rows,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`Tenant ${tenantId} has no head office`);
  return id;
}

const invitationMessage = outboxMessageSchemas['email.user_invitation'];

export interface OutboxInvitation {
  readonly payload: z.infer<typeof invitationMessage>;
  /** The token from the link's fragment. */
  readonly token: string;
  readonly count: number;
}

/**
 * The invitation email the outbox holds for an invitation (read as the owner role, which the relay
 * will stand in for), and the token from its link.
 */
export async function outboxInvitation(
  tenantId: string,
  invitationId: string,
): Promise<OutboxInvitation> {
  const rows = await withOwnerClient(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      const result = await c.query<{ topic: string; payload: unknown }>(
        `select topic, payload from outbox where payload ->> 'invitationId' = $1`,
        [invitationId],
      );
      return result.rows;
    } finally {
      await c.query('commit');
    }
  });
  const [row] = rows;
  if (row === undefined) throw new Error(`No outbox email for invitation ${invitationId}`);
  const payload = invitationMessage.parse(row.payload);
  const token = new URL(payload.acceptUrl).hash.replace(/^#token=/, '');
  return { payload, token, count: rows.length };
}
