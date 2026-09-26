import { type PartyAddressResponse, type PartyResponse, stateCodeSchema } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type PartyRow } from './parties.schema.js';
import { type PartyAddressRow } from './party-addresses.schema.js';

export function toPartyAddressResponse(row: PartyAddressRow): PartyAddressResponse {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    // char(2) in the table (format-checked); null abroad.
    stateCode: row.stateCode === null ? null : stateCodeSchema.parse(row.stateCode),
    pincode: row.pincode,
    country: row.country,
    isDefault: row.isDefault,
  };
}

/** The party fields as the contracts carry them (money as a paise string). */
function partyFields(row: PartyRow) {
  return {
    code: row.code,
    name: row.name,
    partyType: row.partyType,
    gstRegistrationType: row.gstRegistrationType,
    gstin: row.gstin,
    pan: row.pan,
    creditLimit: row.creditLimit === null ? null : row.creditLimit.toString(),
    creditDays: row.creditDays,
    paymentTerms: row.paymentTerms,
    contactPerson: row.contactPerson,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    isActive: row.isActive,
  };
}

/** A party with its addresses, as `partyResponseSchema` describes it. */
export function toPartyResponse(
  row: PartyRow,
  addresses: readonly PartyAddressRow[],
): PartyResponse {
  return {
    ...recordMetaOf(row),
    ...partyFields(row),
    addresses: addresses.map(toPartyAddressResponse),
  };
}

/**
 * The stored party as the input of `partyRecordSchema` (its addresses keep their `id`), for the
 * merged-record validation of a PATCH.
 */
export function toPartyRecordInput(row: PartyRow, addresses: readonly PartyAddressRow[]) {
  return { ...partyFields(row), addresses: addresses.map(toPartyAddressResponse) };
}
