import { type GstinLookupResponse, type GstinStatus } from '@ekaro/contracts';
import { getState, gstinPan, gstinStateCode, isValidStateCode } from '@ekaro/core';
import { type GspProvider } from './gsp-provider.js';

/** PANs starting with this return a cancelled registration, so tests can exercise rejection. */
export const MOCK_CANCELLED_PAN_PREFIX = 'ZZZZZ';

/** The fourth PAN character is the holder type (C company, F firm, P person, ...). */
function legalNameFor(pan: string): string {
  switch (pan.charAt(3)) {
    case 'C':
      return `${pan} Private Limited`;
    case 'F':
      return `${pan} and Associates`;
    default:
      return `${pan} Enterprises`;
  }
}

/**
 * Deterministic stand-in for a real GSP (dev and tests; the testing standard forbids real
 * network). Everything derives from the GSTIN: the state from its first 2 digits, the names and
 * address from the PAN, and `Cancelled` for PANs starting with `ZZZZZ`, otherwise `Active`.
 */
export class MockGspProvider implements GspProvider {
  lookupGstin(gstin: string): Promise<GstinLookupResponse> {
    const stateCode = gstinStateCode(gstin);
    // gstinStateCode() already rejects unknown states; this narrows the type.
    if (!isValidStateCode(stateCode)) throw new RangeError(`Unknown state in GSTIN "${gstin}"`);
    const pan = gstinPan(gstin);
    const digits = pan.slice(5, 9);
    const status: GstinStatus = pan.startsWith(MOCK_CANCELLED_PAN_PREFIX) ? 'Cancelled' : 'Active';
    return Promise.resolve({
      gstin,
      legalName: legalNameFor(pan),
      tradeName: `${pan} Traders`,
      pan,
      stateCode,
      status,
      address: {
        line1: `Unit ${digits}, Industrial Estate`,
        line2: null,
        city: getState(stateCode)?.name ?? stateCode,
        // A valid PIN (first digit 1-9): a zone digit from the state code, then the PAN digits.
        pincode: `${(Number(stateCode) % 9) + 1}${digits}0`,
        stateCode,
      },
    });
  }
}
