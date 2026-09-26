import { z } from 'zod';
import { pincodeSchema, stateCodeSchema, text } from '../common/primitives.js';

/** `?active=true|false` on master lists. */
export const activeFilterSchema = z.stringbool().optional();

/** The flat address carried by company and branches (always in India). */
export const indianAddressShape = {
  line1: text(200),
  line2: text(200).nullable(),
  city: text(100),
  pincode: pincodeSchema,
  stateCode: stateCodeSchema,
};

interface GstinFields {
  gstin?: string | null | undefined;
  pan?: string | null | undefined;
}

/**
 * GSTIN consistency (spec 02 §5): the GSTIN's state code (characters 1–2) must equal `stateCode`,
 * and a PAN, when given, must equal the GSTIN's PAN (characters 3–12). Each check runs only when
 * both of its values are present, so a PATCH that sends one of them is checked by the service.
 */
export function checkGstinConsistency(
  value: GstinFields,
  stateCode: string | null | undefined,
  ctx: z.RefinementCtx,
): void {
  const { gstin, pan } = value;
  if (!gstin) return;
  if (stateCode && gstin.slice(0, 2) !== stateCode) {
    ctx.addIssue({
      code: 'custom',
      path: ['gstin'],
      message: `The GSTIN is registered in state ${gstin.slice(0, 2)}, not ${stateCode}`,
    });
  }
  if (pan && gstin.slice(2, 12) !== pan) {
    ctx.addIssue({ code: 'custom', path: ['pan'], message: 'The PAN does not match the GSTIN' });
  }
}
