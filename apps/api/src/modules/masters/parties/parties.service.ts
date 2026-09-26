import {
  type PartyCreate,
  type PartyListQuery,
  partyRecordSchema,
  type PartyResponse,
  type PartyUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import { type ConstraintErrors, mapConstraintErrors } from '../../../infra/db/constraint-errors.js';
import { type Page, pageOf } from '../../../infra/db/list-query.js';
import { toPartyRecordInput, toPartyResponse } from './parties.mapper.js';
import { PartiesRepository } from './parties.repository.js';
import { type PartyRow } from './parties.schema.js';
import { type PartyAddressRow } from './party-addresses.schema.js';
import { type DesiredAddress, planAddressChanges } from './party-addresses.plan.js';

const constraintErrors = (code: string | undefined): ConstraintErrors => ({
  parties_tenant_code_unique: () =>
    new ConflictError('ALREADY_EXISTS', `A party with code ${code ?? ''} already exists.`),
});

/** Paise travel as strings and are stored as `bigint`. */
const toPaise = (value: string | null): bigint | null => (value === null ? null : BigInt(value));

/**
 * Customers and vendors with their addresses (MS-03, spec 02). The contract's record schema holds
 * the party rules (GSTIN by registration type, GSTIN state = the default billing address state,
 * PAN, exactly one default billing address); a PATCH validates the merged record, and sending
 * `addresses` replaces the list (ids keep stored addresses). `creditLimit` is paise: null means no
 * limit, "0" cash only. DELETE deactivates.
 */
@Injectable()
export class PartiesService {
  constructor(private readonly parties: PartiesRepository) {}

  async list(query: PartyListQuery): Promise<Page<PartyResponse>> {
    const { rows, total } = await this.parties.list(query);
    return pageOf(await this.withAddresses(rows), total, query);
  }

  async get(id: string): Promise<PartyResponse> {
    const [party] = await this.withAddresses([await this.require(id)]);
    if (party === undefined) throw notFound();
    return party;
  }

  async create(input: PartyCreate): Promise<PartyResponse> {
    const { addresses, creditLimit, ...fields } = input;
    const withId = addresses.findIndex((a) => a.id !== undefined);
    if (withId >= 0) {
      throw ValidationError.forField(`addresses.${String(withId)}.id`, 'A new address has no id');
    }
    const row = await mapConstraintErrors(
      () => this.parties.insert({ ...fields, creditLimit: toPaise(creditLimit) }),
      constraintErrors(fields.code),
    );
    await this.parties.insertAddresses(row.id, planAddressChanges([], addresses).inserts);
    return this.get(row.id);
  }

  async update(id: string, patch: PartyUpdate): Promise<PartyResponse> {
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    const stored = await this.parties.addressesOf([id]);
    const merged = parseMergedRecord(
      partyRecordSchema,
      toPartyRecordInput(existing, stored),
      changes,
    );
    const { addresses, creditLimit, ...partyChanges } = changes;
    await mapConstraintErrors(
      () =>
        this.parties.update(id, {
          ...partyChanges,
          ...(creditLimit === undefined ? {} : { creditLimit: toPaise(creditLimit) }),
        }),
      constraintErrors(changes.code),
    );
    if (addresses !== undefined) await this.replaceAddresses(id, stored, merged.addresses);
    return this.get(id);
  }

  /** Deactivates the party (masters are never hard deleted once they can be referenced). */
  async remove(id: string): Promise<void> {
    const existing = await this.require(id, { forUpdate: true });
    if (existing.isActive) await this.parties.update(id, { isActive: false });
  }

  private async replaceAddresses(
    partyId: string,
    stored: readonly PartyAddressRow[],
    desired: readonly DesiredAddress[],
  ): Promise<void> {
    const plan = planAddressChanges(stored, desired);
    if (plan.errors.length > 0) throw new ValidationError(plan.errors);
    await this.parties.deleteAddresses(plan.deleteIds);
    await this.parties.clearDefaults(plan.clearDefaultIds);
    for (const { id, fields } of plan.updates) await this.parties.updateAddress(id, fields);
    await this.parties.insertAddresses(partyId, plan.inserts);
  }

  private async withAddresses(rows: readonly PartyRow[]): Promise<PartyResponse[]> {
    const addresses = await this.parties.addressesOf(rows.map((r) => r.id));
    const byParty = new Map<string, PartyAddressRow[]>();
    for (const address of addresses) {
      const list = byParty.get(address.partyId);
      if (list === undefined) byParty.set(address.partyId, [address]);
      else list.push(address);
    }
    return rows.map((row) => toPartyResponse(row, byParty.get(row.id) ?? []));
  }

  private async require(id: string, options: { forUpdate?: boolean } = {}): Promise<PartyRow> {
    const row = await this.parties.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Party not found.');
