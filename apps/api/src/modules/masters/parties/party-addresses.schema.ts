import { ADDRESS_KINDS } from '@ekaro/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, lengthBetween, pincodeFormat, stateCodeFormat } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';
import { parties } from './parties.schema.js';

/**
 * Billing and shipping addresses of a party (spec 02 §2), owned by the party: written only
 * through the party's API. At most one default per kind (the contracts also require exactly one
 * default billing address). An Indian address has a state and a 6-digit PIN; a foreign one has
 * no state and a free-form postcode.
 */
export const partyAddresses = tenantTable(
  'party_addresses',
  {
    partyId: uuid().notNull(),
    kind: text({ enum: ADDRESS_KINDS }).notNull(),
    label: text(),
    line1: text().notNull(),
    line2: text(),
    city: text().notNull(),
    /** Null abroad. */
    stateCode: char({ length: 2 }),
    pincode: text(),
    country: char({ length: 2 }).notNull().default('IN'),
    isDefault: boolean().notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: 'party_addresses_party_fk',
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    index('party_addresses_tenant_party_idx').on(t.tenantId, t.partyId),
    uniqueIndex('party_addresses_one_default_per_kind')
      .on(t.tenantId, t.partyId, t.kind)
      .where(sql`${t.isDefault}`),
    check('party_addresses_kind_valid', inList(t.kind, ADDRESS_KINDS)),
    check('party_addresses_label_length', lengthBetween(t.label, 1, 50)),
    check('party_addresses_line1_length', lengthBetween(t.line1, 1, 200)),
    check('party_addresses_line2_length', lengthBetween(t.line2, 1, 200)),
    check('party_addresses_city_length', lengthBetween(t.city, 1, 100)),
    check('party_addresses_country_format', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('party_addresses_state_code_format', stateCodeFormat(t.stateCode)),
    check(
      'party_addresses_indian_or_foreign',
      sql`(${t.country} = 'IN' and ${t.stateCode} is not null and ${t.pincode} is not null and ${pincodeFormat(t.pincode)})
        or (${t.country} <> 'IN' and ${t.stateCode} is null and coalesce(char_length(${t.pincode}), 0) <= 10)`,
    ),
  ],
);

export type PartyAddressRow = typeof partyAddresses.$inferSelect;
export type NewPartyAddressRow = typeof partyAddresses.$inferInsert;
