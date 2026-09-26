import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';

const schemas: [string, z.ZodType][] = [];
for (const [name, value] of Object.entries(contracts)) {
  if (value instanceof z.ZodType) schemas.push([name, value]);
}

describe('package root', () => {
  it('exports the schemas of every area', () => {
    const names = schemas.map(([name]) => name);
    for (const name of [
      'uuidSchema',
      'moneySchema',
      'problemSchema',
      'permissionSchema',
      'signupSchema',
      'meResponseSchema',
      'roleCreateSchema',
      'userInviteSchema',
      'userUpdateSchema',
      'userResponseSchema',
      'userRecordSchema',
      'companyUpdateSchema',
      'branchCreateSchema',
      'godownCreateSchema',
      'unitCreateSchema',
      'taxRateCreateSchema',
      'itemCategoryTreeNodeSchema',
      'itemCreateSchema',
      'partyCreateSchema',
      'documentSeriesCreateSchema',
      'gstinLookupResponseSchema',
      'currentStateCodeSchema',
      'placeOfSupplySchema',
      'companyRecordSchema',
      'branchRecordSchema',
      'taxRateRecordSchema',
      'itemRecordSchema',
      'partyRecordSchema',
      'documentSeriesRecordSchema',
    ]) {
      expect(names, name).toContain(name);
    }
    expect(contracts.PERMISSIONS.length).toBeGreaterThan(0);
    expect(contracts.DEFAULT_ROLES).toHaveLength(9);
    expect(contracts.DocType.sales_invoice).toBe('sales_invoice');
    expect(typeof contracts.sortSchema).toBe('function');
    expect(typeof contracts.updateSchema).toBe('function');
    for (const renamed of [
      'inviteUserSchema',
      'membershipUpdateSchema',
      'membershipResponseSchema',
    ]) {
      expect(names, renamed).not.toContain(renamed);
    }
  });

  // ADR 0013: the OpenAPI document is generated from these schemas with z.toJSONSchema.
  it.each(schemas)('%s converts to JSON Schema for requests and responses', (_name, schema) => {
    expect(() => z.toJSONSchema(schema, { io: 'input' })).not.toThrow();
    expect(() => z.toJSONSchema(schema, { io: 'output' })).not.toThrow();
  });
});
