import { z } from 'zod';
import {
  currentStateCodeSchema,
  pincodeSchema,
  stateCodeSchema,
  text,
} from '../common/primitives.js';

/** `?active=true|false` on master lists. */
export const activeFilterSchema = z.stringbool().optional();

/** The flat address carried by company and branches (always in India, current state codes). */
export const indianAddressShape = {
  line1: text(200),
  line2: text(200).nullable(),
  city: text(100),
  pincode: pincodeSchema,
  stateCode: currentStateCodeSchema,
};

/** The same address as stored and returned. */
export const indianAddressResponseShape = {
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  pincode: z.string(),
  stateCode: stateCodeSchema,
};

export interface GstinConsistencyInput {
  readonly gstin: string | null;
  readonly pan: string | null;
  /** The state the GSTIN must be registered in; null when there is none to compare. */
  readonly stateCode: string | null;
}

/**
 * GSTIN consistency (spec 02 §5): the GSTIN's state code (characters 1–2) must equal `stateCode`,
 * and a PAN, when given, must equal the GSTIN's PAN (characters 3–12).
 */
export function checkGstinConsistency(value: GstinConsistencyInput, ctx: z.RefinementCtx): void {
  const { gstin, pan, stateCode } = value;
  if (gstin === null) return;
  if (stateCode !== null && gstin.slice(0, 2) !== stateCode) {
    ctx.addIssue({
      code: 'custom',
      path: ['gstin'],
      message: `The GSTIN is registered in state ${gstin.slice(0, 2)}, not ${stateCode}`,
    });
  }
  if (pan !== null && gstin.slice(2, 12) !== pan) {
    ctx.addIssue({ code: 'custom', path: ['pan'], message: 'The PAN does not match the GSTIN' });
  }
}
