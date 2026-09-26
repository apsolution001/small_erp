import { z } from 'zod';
import { gstinSchema, panSchema, stateCodeSchema } from '../common/primitives.js';
import { indianAddressShape } from '../masters/shared.js';

/** Registration status as the GST portal reports it. Only `Active` may sign up. */
export const GSTIN_STATUSES = ['Active', 'Cancelled', 'Suspended', 'Inactive'] as const;
export const gstinStatusSchema = z.enum(GSTIN_STATUSES);
export type GstinStatus = z.infer<typeof gstinStatusSchema>;

/** `GET /platform/gstin/:gstin` path parameters. */
export const gstinLookupParamsSchema = z.object({ gstin: gstinSchema });
export type GstinLookupParams = z.infer<typeof gstinLookupParamsSchema>;

/**
 * `GET /platform/gstin/:gstin`: the registration details that pre-fill signup and seed the
 * company profile. The address is the principal place of business.
 */
export const gstinLookupResponseSchema = z.object({
  gstin: gstinSchema,
  legalName: z.string(),
  tradeName: z.string().nullable(),
  pan: panSchema,
  stateCode: stateCodeSchema,
  status: gstinStatusSchema,
  address: z.object(indianAddressShape),
});
export type GstinLookupResponse = z.infer<typeof gstinLookupResponseSchema>;
