import { type PartyListQuery, type PartyType } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, count, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import {
  containsPattern,
  orderByOf,
  pageOffset,
  prefixPattern,
} from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import { type NewPartyRow, parties, type PartyRow } from './parties.schema.js';
import {
  type NewPartyAddressRow,
  partyAddresses,
  type PartyAddressRow,
} from './party-addresses.schema.js';

export type PartyChanges = RowChanges<
  NewPartyRow,
  | 'code'
  | 'name'
  | 'partyType'
  | 'gstRegistrationType'
  | 'gstin'
  | 'pan'
  | 'creditLimit'
  | 'creditDays'
  | 'paymentTerms'
  | 'contactPerson'
  | 'email'
  | 'phone'
  | 'notes'
  | 'isActive'
>;

/** The address columns a party write sets (the party and the audit columns are implied). */
export type AddressFields = Omit<
  NewPartyAddressRow,
  'id' | 'tenantId' | 'partyId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'version'
>;

/** `?type=customer` includes parties that are both customer and vendor, likewise for vendors. */
const TYPES_MATCHING: Readonly<Record<PartyType, PartyType[]>> = {
  customer: ['customer', 'both'],
  vendor: ['vendor', 'both'],
  both: ['both'],
};

/** Drizzle queries on `parties` and the addresses it owns, in the request's tenant transaction. */
@Injectable()
export class PartiesRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  async list(query: PartyListQuery): Promise<{ rows: PartyRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(parties)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'name:asc',
          { code: parties.code, name: parties.name, createdAt: parties.createdAt },
          parties.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize));
    const [totals] = await this.db.select({ total: count() }).from(parties).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<PartyRow | undefined> {
    const query = this.db.select().from(parties).where(eq(parties.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  async insert(values: NewPartyRow): Promise<PartyRow> {
    const [row] = await this.db.insert(parties).values(values).returning();
    if (row === undefined) throw new Error('Party insert returned no row');
    return row;
  }

  async update(id: string, changes: PartyChanges): Promise<PartyRow> {
    const [row] = await this.db
      .update(parties)
      .set({ ...changes, version: sql`${parties.version} + 1` })
      .where(eq(parties.id, id))
      .returning();
    if (row === undefined) throw new Error(`Party ${id} vanished during its update`);
    return row;
  }

  /** The addresses of each party, oldest first (one query for a whole page). */
  async addressesOf(partyIds: readonly string[]): Promise<PartyAddressRow[]> {
    if (partyIds.length === 0) return [];
    return this.db
      .select()
      .from(partyAddresses)
      .where(inArray(partyAddresses.partyId, [...partyIds]))
      .orderBy(asc(partyAddresses.id));
  }

  async insertAddresses(partyId: string, addresses: readonly AddressFields[]): Promise<void> {
    if (addresses.length === 0) return;
    await this.db.insert(partyAddresses).values(addresses.map((a) => ({ ...a, partyId })));
  }

  async updateAddress(id: string, fields: AddressFields): Promise<void> {
    await this.db
      .update(partyAddresses)
      .set({ ...fields, version: sql`${partyAddresses.version} + 1` })
      .where(eq(partyAddresses.id, id));
  }

  async deleteAddresses(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(partyAddresses).where(inArray(partyAddresses.id, [...ids]));
  }

  /** Clears the default flag first, so a default can move between addresses (partial index). */
  async clearDefaults(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(partyAddresses)
      .set({ isDefault: false, version: sql`${partyAddresses.version} + 1` })
      .where(inArray(partyAddresses.id, [...ids]));
  }
}

function filtersOf(query: PartyListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) {
    const contains = containsPattern(query.q);
    const search = or(
      ilike(parties.name, contains),
      ilike(parties.code, contains),
      ilike(parties.gstin, prefixPattern(query.q)),
    );
    if (search !== undefined) filters.push(search);
  }
  if (query.type !== undefined)
    filters.push(inArray(parties.partyType, TYPES_MATCHING[query.type]));
  if (query.active !== undefined) filters.push(eq(parties.isActive, query.active));
  return filters;
}
