import { sql } from 'drizzle-orm';
import { boolean, char, check, date, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import {
  gstinFormat,
  inList,
  lengthBetween,
  pincodeFormat,
  stateCodeFormat,
} from '../../../infra/db/checks.js';
import { tenantAuditColumns, tenantIdColumn } from '../../../infra/db/columns.js';

/** Stock valuation (spec 02 §2). Mirrors `VALUATION_METHODS` in `@ekaro/contracts`. */
export const VALUATION_METHODS = ['fifo', 'weighted_average'] as const;

/**
 * One row per tenant, keyed by the tenant (spec 02 §2). Tenant table (RLS + audit), plus a
 * `platform_read` policy so login can show company names across a user's tenants.
 */
export const companyProfile = pgTable(
  'company_profile',
  {
    tenantId: tenantIdColumn().primaryKey(),
    legalName: text().notNull(),
    tradeName: text(),
    /** Null for an unregistered business. */
    gstin: char({ length: 15 }),
    pan: char({ length: 10 }),
    stateCode: char({ length: 2 }).notNull(),
    line1: text().notNull(),
    line2: text(),
    city: text().notNull(),
    pincode: char({ length: 6 }).notNull(),
    email: text(),
    phone: text(),
    logoObjectKey: text(),
    booksBeginDate: date({ mode: 'string' }).notNull(),
    /** Editable only until the first stock posting (enforced from Sprint 2). */
    valuationMethod: text({ enum: VALUATION_METHODS }).notNull().default('weighted_average'),
    allowNegativeStock: boolean().notNull().default(false),
    roundOffSales: boolean().notNull().default(true),
    hsnMinDigits: smallint().notNull().default(4),
    eInvoiceEnabled: boolean().notNull().default(false),
    ...tenantAuditColumns(),
  },
  (t) => [
    check('company_profile_legal_name_length', lengthBetween(t.legalName, 1, 200)),
    check('company_profile_trade_name_length', lengthBetween(t.tradeName, 1, 200)),
    check('company_profile_gstin_format', gstinFormat(t.gstin)),
    check('company_profile_gstin_state', sql`left(${t.gstin}, 2) = ${t.stateCode}`),
    check('company_profile_pan_format', sql`${t.pan} ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`),
    check('company_profile_pan_matches_gstin', sql`substr(${t.gstin}, 3, 10) = ${t.pan}`),
    check('company_profile_state_code_format', stateCodeFormat(t.stateCode)),
    check('company_profile_pincode_format', pincodeFormat(t.pincode)),
    check('company_profile_valuation_method_valid', inList(t.valuationMethod, VALUATION_METHODS)),
    check('company_profile_hsn_min_digits_valid', sql`${t.hsnMinDigits} in (4, 6)`),
  ],
);

export type CompanyProfileRow = typeof companyProfile.$inferSelect;
export type NewCompanyProfileRow = typeof companyProfile.$inferInsert;
