import { inArray } from 'drizzle-orm';
import { type DbExecutor } from '../../../infra/db/db-executor.js';
import { companyProfile } from './company-profile.schema.js';

/**
 * Display name of each tenant's company: the trade name, else the legal name. Cross-tenant on
 * the platform connection (`platform_read`), for login's tenant list and session responses.
 */
export async function findCompanyNames(
  db: DbExecutor,
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  if (tenantIds.length === 0) return new Map();
  const rows = await db
    .select({
      tenantId: companyProfile.tenantId,
      legalName: companyProfile.legalName,
      tradeName: companyProfile.tradeName,
    })
    .from(companyProfile)
    .where(inArray(companyProfile.tenantId, [...tenantIds]));
  return new Map(rows.map((r) => [r.tenantId, r.tradeName ?? r.legalName]));
}
