import { type GstinLookupResponse } from '@ekaro/contracts';

/**
 * GST Suvidha Provider port (ADR 0012). Sprint 1 needs only the GSTIN lookup; e-invoice and
 * e-way bill calls join it in Sprint 4. Adapters are selected by `GSP_PROVIDER`.
 */
export interface GspProvider {
  /** Registration details of a GSTIN that is already known to be well-formed (checksum ok). */
  lookupGstin(gstin: string): Promise<GstinLookupResponse>;
}

export const GSP_PROVIDER = Symbol('GSP_PROVIDER');
