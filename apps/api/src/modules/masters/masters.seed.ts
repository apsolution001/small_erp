import { and, eq } from 'drizzle-orm';
import { type DbExecutor } from '../../infra/db/db-executor.js';
import { branches } from './branches/branches.schema.js';
import { buildHeadOffice } from './branches/branches.seed.js';
import { companyProfile } from './company/company-profile.schema.js';
import { buildCompanyProfile, type CompanySeed } from './company/company.seed.js';
import { documentSeries } from './document-series/document-series.schema.js';
import { buildDefaultSeries } from './document-series/document-series.seed.js';
import { godowns } from './godowns/godowns.schema.js';
import { buildMainGodown } from './godowns/godowns.seed.js';
import { taxRates } from './tax-rates/tax-rates.schema.js';
import { buildDefaultTaxRates } from './tax-rates/tax-rates.seed.js';
import { units } from './units/units.schema.js';
import { buildDefaultUnits } from './units/units.seed.js';

export interface MastersSeedResult {
  readonly headOfficeBranchId: string;
}

/**
 * Seeds the masters of a new tenant (spec 02 §4): company profile, head-office branch, Main
 * godown, units, GST slabs and the default series of every document type for the current FY.
 *
 * Runs inside the caller's transaction, which must carry the tenant in `app.tenant_id` (the
 * rows take it from the column default and pass RLS). Idempotent: every insert skips rows that
 * already exist by business key, so re-running it after a partial failure completes the set.
 */
export async function seedTenantMasters(
  db: DbExecutor,
  tenantId: string,
  seed: CompanySeed,
): Promise<MastersSeedResult> {
  await db.insert(companyProfile).values(buildCompanyProfile(seed)).onConflictDoNothing();
  await db.insert(branches).values(buildHeadOffice(seed)).onConflictDoNothing();

  const [headOffice] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isHeadOffice, true)));
  if (headOffice === undefined) {
    throw new Error(`Tenant ${tenantId} has no head office after seeding`);
  }

  await db.insert(godowns).values(buildMainGodown(headOffice.id)).onConflictDoNothing();
  await db.insert(units).values(buildDefaultUnits()).onConflictDoNothing();
  await db.insert(taxRates).values(buildDefaultTaxRates()).onConflictDoNothing();
  await db
    .insert(documentSeries)
    .values(buildDefaultSeries(headOffice.id, seed.fy))
    .onConflictDoNothing();

  return { headOfficeBranchId: headOffice.id };
}
