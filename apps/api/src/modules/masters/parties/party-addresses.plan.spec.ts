import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { type PartyAddressRow } from './party-addresses.schema.js';
import { type DesiredAddress, planAddressChanges } from './party-addresses.plan.js';

const at = new Date('2026-04-01T04:30:00.000Z');

function stored(overrides: Partial<PartyAddressRow> = {}): PartyAddressRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    partyId: uuidv7(),
    kind: 'billing',
    label: null,
    line1: '12 MG Road',
    line2: null,
    city: 'Pune',
    stateCode: '27',
    pincode: '411001',
    country: 'IN',
    isDefault: true,
    createdAt: at,
    createdBy: null,
    updatedAt: at,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

const desiredOf = (
  row: PartyAddressRow,
  overrides: Partial<DesiredAddress> = {},
): DesiredAddress => ({
  id: row.id,
  kind: row.kind,
  label: row.label,
  line1: row.line1,
  line2: row.line2,
  city: row.city,
  stateCode: row.stateCode === null ? null : '27',
  pincode: row.pincode,
  country: row.country,
  isDefault: row.isDefault,
  ...overrides,
});

describe('planAddressChanges', () => {
  it('writes nothing when the list is unchanged', () => {
    const billing = stored();
    expect(planAddressChanges([billing], [desiredOf(billing)])).toEqual({
      errors: [],
      deleteIds: [],
      clearDefaultIds: [],
      updates: [],
      inserts: [],
    });
  });

  it('updates changed addresses, inserts new ones and deletes the ones left out', () => {
    const billing = stored();
    const shipping = stored({ kind: 'shipping', isDefault: false });
    const { id: _id, ...fresh } = desiredOf(stored({ kind: 'shipping', city: 'Nashik' }));
    const plan = planAddressChanges(
      [billing, shipping],
      [desiredOf(billing, { city: 'Pimpri' }), fresh],
    );
    expect(plan.errors).toEqual([]);
    expect(plan.deleteIds).toEqual([shipping.id]);
    expect(plan.updates).toEqual([
      { id: billing.id, fields: expect.objectContaining({ city: 'Pimpri', isDefault: true }) },
    ]);
    expect(plan.inserts).toEqual([expect.objectContaining({ kind: 'shipping', city: 'Nashik' })]);
    expect(plan.clearDefaultIds).toEqual([]);
  });

  it('clears a default that moves to another address before any update', () => {
    const first = stored();
    const second = stored({ isDefault: false, city: 'Mumbai' });
    const plan = planAddressChanges(
      [first, second],
      [desiredOf(first, { isDefault: false }), desiredOf(second, { isDefault: true })],
    );
    expect(plan.clearDefaultIds).toEqual([first.id]);
    // Clearing already wrote the first address's only change.
    expect(plan.updates.map((u) => [u.id, u.fields.isDefault])).toEqual([[second.id, true]]);
  });

  it('still updates a cleared default whose other fields change too', () => {
    const first = stored();
    const second = stored({ isDefault: false, city: 'Mumbai' });
    const plan = planAddressChanges(
      [first, second],
      [
        desiredOf(first, { isDefault: false, label: 'Old office' }),
        desiredOf(second, { isDefault: true }),
      ],
    );
    expect(plan.clearDefaultIds).toEqual([first.id]);
    expect(plan.updates.map((u) => [u.id, u.fields.label])).toEqual([
      [first.id, 'Old office'],
      [second.id, null],
    ]);
  });

  it('refuses an id that is not one of the party addresses, or listed twice', () => {
    const billing = stored();
    const plan = planAddressChanges(
      [billing],
      [desiredOf(billing), desiredOf(billing), { ...desiredOf(billing), id: uuidv7() }],
    );
    expect(plan.errors).toEqual([
      { path: 'addresses.1.id', message: 'Listed twice', code: 'custom' },
      { path: 'addresses.2.id', message: 'Not an address of this party', code: 'custom' },
    ]);
  });
});
