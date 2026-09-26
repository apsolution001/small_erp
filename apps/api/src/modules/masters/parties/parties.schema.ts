import { GST_REGISTRATION_TYPES, GSTIN_REQUIRED_FOR, PARTY_TYPES } from '@ekaro/contracts';
import { sql } from 'drizzle-orm';
import { bigint, boolean, char, check, index, integer, text, unique } from 'drizzle-orm/pg-core';
import { gstinFormat, inList, lengthBetween, panFormat } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';

/**
 * Customers and vendors (MS-03, spec 02 §2). The checks mirror the contract rules that need no
 * other table: a GSTIN exactly for regular, composition and SEZ registrations, its PAN, a
 * non-negative credit limit. The GSTIN state against the default billing address is checked on
 * the whole record by the service.
 */
export const parties = tenantTable(
  'parties',
  {
    code: text().notNull(),
    name: text().notNull(),
    partyType: text({ enum: PARTY_TYPES }).notNull(),
    gstRegistrationType: text({ enum: GST_REGISTRATION_TYPES }).notNull(),
    gstin: char({ length: 15 }),
    pan: char({ length: 10 }),
    /** Paise; null = no limit, 0 = cash only. */
    creditLimit: bigint({ mode: 'bigint' }),
    creditDays: integer(),
    paymentTerms: text(),
    contactPerson: text(),
    email: text(),
    phone: text(),
    notes: text(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('parties_tenant_code_unique').on(t.tenantId, t.code),
    // Target of the composite foreign key from party_addresses (and later documents).
    unique('parties_tenant_id_unique').on(t.tenantId, t.id),
    index('parties_tenant_name_idx').on(t.tenantId, t.name),
    index('parties_tenant_gstin_idx').on(t.tenantId, t.gstin),
    check('parties_code_length', lengthBetween(t.code, 1, 30)),
    check('parties_name_length', lengthBetween(t.name, 1, 200)),
    check('parties_party_type_valid', inList(t.partyType, PARTY_TYPES)),
    check(
      'parties_gst_registration_type_valid',
      inList(t.gstRegistrationType, GST_REGISTRATION_TYPES),
    ),
    check('parties_gstin_format', gstinFormat(t.gstin)),
    check(
      'parties_gstin_by_registration',
      sql`(${inList(t.gstRegistrationType, GSTIN_REQUIRED_FOR)}) = (${t.gstin} is not null)`,
    ),
    check('parties_pan_format', panFormat(t.pan)),
    check('parties_pan_matches_gstin', sql`substr(${t.gstin}, 3, 10) = ${t.pan}`),
    check('parties_credit_limit_non_negative', sql`${t.creditLimit} >= 0`),
    check('parties_credit_days_range', sql`${t.creditDays} between 0 and 999`),
    check('parties_payment_terms_length', lengthBetween(t.paymentTerms, 1, 200)),
    check('parties_contact_person_length', lengthBetween(t.contactPerson, 1, 120)),
    check('parties_notes_length', lengthBetween(t.notes, 1, 1000)),
  ],
);

export type PartyRow = typeof parties.$inferSelect;
export type NewPartyRow = typeof parties.$inferInsert;
