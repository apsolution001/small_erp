import { type PartyCreate } from '@ekaro/contracts';
import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type PartiesRepository } from './parties.repository.js';
import { type PartyRow } from './parties.schema.js';
import { PartiesService } from './parties.service.js';
import { type PartyAddressRow } from './party-addresses.schema.js';

const at = new Date('2026-04-01T04:30:00.000Z');
const GSTIN = '27AAPFU0939F1ZV';

function partyRow(overrides: Partial<PartyRow> = {}): PartyRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    code: 'C-001',
    name: 'Acme Traders',
    partyType: 'customer',
    gstRegistrationType: 'regular',
    gstin: GSTIN,
    pan: null,
    creditLimit: 50000000n,
    creditDays: 30,
    paymentTerms: null,
    contactPerson: null,
    email: null,
    phone: null,
    notes: null,
    isActive: true,
    createdAt: at,
    createdBy: null,
    updatedAt: at,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

function billing(partyId: string): PartyAddressRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    partyId,
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
  };
}

const address = {
  kind: 'billing' as const,
  label: null,
  line1: '12 MG Road',
  line2: null,
  city: 'Pune',
  stateCode: '27' as const,
  pincode: '411001',
  country: 'IN',
  isDefault: true,
};

const createInput = (overrides: Partial<PartyCreate> = {}): PartyCreate => ({
  code: 'C-001',
  name: 'Acme Traders',
  partyType: 'customer',
  gstRegistrationType: 'regular',
  gstin: GSTIN,
  pan: null,
  creditLimit: '50000000',
  creditDays: 30,
  paymentTerms: null,
  contactPerson: null,
  email: null,
  phone: null,
  notes: null,
  isActive: true,
  addresses: [address],
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected a failure');
}

const paths = (error: DomainError) => (error as ValidationError).errors.map((e) => e.path);

describe('PartiesService', () => {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    addressesOf: vi.fn(),
    insertAddresses: vi.fn(),
    updateAddress: vi.fn(),
    deleteAddresses: vi.fn(),
    clearDefaults: vi.fn(),
  };
  const service = new PartiesService(repo as unknown as PartiesRepository);

  beforeEach(() => {
    vi.resetAllMocks();
    repo.addressesOf.mockResolvedValue([]);
  });

  it('stores the credit limit as bigint paise and returns it as a string', async () => {
    const row = partyRow();
    repo.insert.mockResolvedValue(row);
    repo.findById.mockResolvedValue(row);
    const created = await service.create(createInput());
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ creditLimit: 50000000n }));
    expect(repo.insertAddresses).toHaveBeenCalledWith(row.id, [
      expect.objectContaining({ city: 'Pune' }),
    ]);
    expect(created.creditLimit).toBe('50000000');
  });

  it('refuses an address id on create', async () => {
    const error = await failure(
      service.create(createInput({ addresses: [{ ...address, id: uuidv7() }] })),
    );
    expect(paths(error)).toEqual(['addresses.0.id']);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  describe('update', () => {
    it('validates the merged record: a billing state away from the GSTIN is a 422', async () => {
      const row = partyRow();
      const stored = billing(row.id);
      repo.findById.mockResolvedValue(row);
      repo.addressesOf.mockResolvedValue([stored]);
      const error = await failure(
        service.update(row.id, {
          addresses: [{ ...address, id: stored.id, stateCode: '29', pincode: '560025' }],
          version: 1,
        }),
      );
      expect(paths(error)).toEqual(['gstin']);
    });

    it('rejects a registration change that leaves a GSTIN behind', async () => {
      const row = partyRow();
      repo.findById.mockResolvedValue(row);
      repo.addressesOf.mockResolvedValue([billing(row.id)]);
      const error = await failure(
        service.update(row.id, { gstRegistrationType: 'unregistered', version: 1 }),
      );
      expect(paths(error)).toEqual(['gstin']);
    });

    it('writes the party and leaves addresses alone when none are sent', async () => {
      const row = partyRow();
      repo.findById.mockResolvedValue(row);
      repo.addressesOf.mockResolvedValue([billing(row.id)]);
      await service.update(row.id, { creditLimit: null, name: 'Acme', version: 1 });
      expect(repo.update).toHaveBeenCalledWith(row.id, { name: 'Acme', creditLimit: null });
      expect(repo.insertAddresses).not.toHaveBeenCalled();
      expect(repo.deleteAddresses).not.toHaveBeenCalled();
    });

    it('refuses a stale version', async () => {
      repo.findById.mockResolvedValue(partyRow({ version: 2 }));
      expect(await failure(service.update(uuidv7(), { name: 'X', version: 1 }))).toMatchObject({
        code: 'VERSION_CONFLICT',
      });
    });
  });

  it('deactivates on remove, once', async () => {
    const row = partyRow();
    repo.findById.mockResolvedValueOnce(row);
    await service.remove(row.id);
    expect(repo.update).toHaveBeenCalledWith(row.id, { isActive: false });
    repo.findById.mockResolvedValueOnce({ ...row, isActive: false });
    await service.remove(row.id);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
});
