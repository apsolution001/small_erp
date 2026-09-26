import { type PartyRecord } from '@ekaro/contracts';
import { type FieldError } from '../../../common/errors/domain-error.js';
import { type AddressFields } from './parties.repository.js';
import { type PartyAddressRow } from './party-addresses.schema.js';

/** An address of a validated party record: `id` present to keep a stored one. */
export type DesiredAddress = PartyRecord['addresses'][number];

/** The writes that turn the stored addresses into the desired list. */
export interface AddressPlan {
  readonly errors: FieldError[];
  readonly deleteIds: string[];
  /** Stored defaults that stop being the default of their kind; cleared before any update. */
  readonly clearDefaultIds: string[];
  readonly updates: { readonly id: string; readonly fields: AddressFields }[];
  readonly inserts: AddressFields[];
}

const FIELDS = [
  'kind',
  'label',
  'line1',
  'line2',
  'city',
  'stateCode',
  'pincode',
  'country',
  'isDefault',
] as const;

function fieldsOf(address: DesiredAddress): AddressFields {
  return {
    kind: address.kind,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    stateCode: address.stateCode,
    pincode: address.pincode,
    country: address.country,
    isDefault: address.isDefault,
  };
}

/**
 * Plans the replacement of a party's addresses (a PATCH sends the whole list): an address with an
 * `id` updates that stored address (only if something changed), one without is new, and stored
 * addresses left out are deleted. An `id` that is not one of the party's addresses, or appears
 * twice, is a 422 on that address. So the audit log records exactly what changed.
 */
export function planAddressChanges(
  stored: readonly PartyAddressRow[],
  desired: readonly DesiredAddress[],
): AddressPlan {
  const byId = new Map(stored.map((row) => [row.id, row]));
  const errors: FieldError[] = [];
  const kept = new Set<string>();
  const updates: AddressPlan['updates'][number][] = [];
  const inserts: AddressFields[] = [];
  const clearDefaultIds: string[] = [];

  desired.forEach((address, index) => {
    if (address.id === undefined) {
      inserts.push(fieldsOf(address));
      return;
    }
    const row = byId.get(address.id);
    if (row === undefined || kept.has(address.id)) {
      errors.push({
        path: `addresses.${String(index)}.id`,
        message: row === undefined ? 'Not an address of this party' : 'Listed twice',
        code: 'custom',
      });
      return;
    }
    kept.add(address.id);
    const fields = fieldsOf(address);
    // A default that stops being the default of its kind is cleared first; the update then
    // writes only what else changed.
    const clears = row.isDefault && (!fields.isDefault || fields.kind !== row.kind);
    if (clears) clearDefaultIds.push(row.id);
    const before = clears ? { ...row, isDefault: false } : row;
    if (FIELDS.some((field) => fields[field] !== before[field])) {
      updates.push({ id: row.id, fields });
    }
  });

  const deleteIds = stored.filter((row) => !kept.has(row.id)).map((row) => row.id);
  return { errors, deleteIds, clearDefaultIds, updates, inserts };
}
