import { defaultRole } from '@ekaro/contracts';
import { describe, expect, it, vi } from 'vitest';
import { type Env } from '../../../config/env.js';
import { type OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { type RoleRow } from '../roles/roles.schema.js';
import { type RolesRepository } from '../roles/roles.repository.js';
import { fakeCls, principal } from '../testing/fakes.js';
import { type UsersRepository } from '../users/users.repository.js';
import { type InvitationListRow, type InvitationsRepository } from './invitations.repository.js';
import { InvitationsService } from './invitations.service.js';

const NOW = new Date('2026-09-26T06:00:00.000Z');
const ROLE_ID = '01920000-0000-7000-8000-00000000e001';
const INVITATION_ID = '01920000-0000-7000-8000-00000000a001';

const pgError = (code: string, constraint: string) =>
  new Error('Failed query', {
    cause: Object.assign(new Error('db'), { code, severity: 'ERROR', constraint }),
  });

function listRow(overrides: Partial<InvitationListRow> = {}): InvitationListRow {
  return {
    id: INVITATION_ID,
    email: 'new@example.com',
    roleId: ROLE_ID,
    roleName: 'Sales',
    allBranches: true,
    branchIds: [],
    status: 'pending',
    invitedById: principal().userId,
    invitedByName: 'Asha',
    expiresAt: new Date('2026-10-03T06:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function setup() {
  const invitations = {
    insert: vi.fn(() => Promise.resolve({ id: INVITATION_ID })),
    findById: vi.fn(() => Promise.resolve(listRow())),
    revokeOpenByEmail: vi.fn(() => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve(true)),
    companyName: vi.fn(() => Promise.resolve('Mehta Traders')),
  };
  const roles = {
    findById: vi.fn(() =>
      Promise.resolve({
        id: ROLE_ID,
        name: 'Sales',
        isOwner: false,
        permissions: [...defaultRole('Sales').permissions],
      } as RoleRow),
    ),
  };
  const users = {
    activeBranchIds: vi.fn(() => Promise.resolve(new Set<string>())),
    findIdByEmail: vi.fn(() => Promise.resolve(undefined)),
    findUserName: vi.fn(() => Promise.resolve('Asha')),
  };
  const outbox = { enqueue: vi.fn(() => Promise.resolve()) };
  const service = new InvitationsService(
    invitations as unknown as InvitationsRepository,
    roles as unknown as RolesRepository,
    users as unknown as UsersRepository,
    outbox as unknown as OutboxWriter,
    fakeCls(principal()),
    { now: () => NOW },
    { APP_ORIGIN: 'https://app.ekaro.in' } as Env,
  );
  return { service, invitations, users, outbox };
}

const invite = { email: 'new@example.com', roleId: ROLE_ID, allBranches: true, branchIds: [] };

describe('InvitationsService.invite', () => {
  it('stores only the token hash, 7 days out, and queues the email with the link', async () => {
    const { service, invitations, outbox } = setup();
    const response = await service.invite(invite);
    expect(response).toMatchObject({
      id: INVITATION_ID,
      status: 'pending',
      role: { name: 'Sales' },
    });
    expect(invitations.revokeOpenByEmail).toHaveBeenCalledWith('new@example.com', NOW);
    const [[stored]] = invitations.insert.mock.calls as unknown as [
      [{ tokenHash: string; expiresAt: Date }],
    ];
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.expiresAt).toEqual(new Date('2026-10-03T06:00:00.000Z'));
    const [[topic, payload]] = outbox.enqueue.mock.calls as unknown as [
      [string, { acceptUrl: string; companyName: string; invitedByName: string }],
    ];
    expect(topic).toBe('email.user_invitation');
    expect(payload).toMatchObject({ companyName: 'Mehta Traders', invitedByName: 'Asha' });
    const link = new URL(payload.acceptUrl);
    expect(`${link.origin}${link.pathname}`).toBe('https://app.ekaro.in/accept-invitation');
    expect(link.hash).toMatch(/^#token=[A-Za-z0-9_-]{43}$/);
  });

  it('refuses an existing member before writing anything (409)', async () => {
    const { service, users, invitations, outbox } = setup();
    users.findIdByEmail.mockResolvedValueOnce('m-1' as never);
    await expect(service.invite(invite)).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_EXISTS',
    });
    expect(invitations.insert).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('maps a concurrent invitation of the same email to 409', async () => {
    const { service, invitations } = setup();
    invitations.insert.mockRejectedValueOnce(pgError('23505', 'invitations_one_pending_per_email'));
    await expect(service.invite(invite)).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_EXISTS',
    });
  });
});

describe('InvitationsService.revoke', () => {
  it('refuses to revoke a closed invitation (409 INVALID_TRANSITION), 404s an unknown one', async () => {
    const { service, invitations } = setup();
    invitations.revoke.mockResolvedValueOnce(false);
    await expect(service.revoke(INVITATION_ID)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    invitations.findById.mockResolvedValueOnce(undefined as never);
    await expect(service.revoke(INVITATION_ID)).rejects.toMatchObject({ status: 404 });
  });
});

describe('toInvitationResponse', () => {
  it('shows a deleted role and an unknown inviter as null', async () => {
    const { service, invitations } = setup();
    invitations.findById.mockResolvedValueOnce(
      listRow({ roleId: null, roleName: null, invitedByName: null, status: 'revoked' }),
    );
    const res = await service.invite(invite);
    expect(res).toMatchObject({ role: null, invitedBy: null, status: 'revoked' });
  });
});
