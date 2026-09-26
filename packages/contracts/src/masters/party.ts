import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import {
  countryCodeSchema,
  currentStateCodeSchema,
  emailSchema,
  gstinSchema,
  moneySchema,
  nonNegativeMoneySchema,
  panSchema,
  phoneSchema,
  pincodeSchema,
  recordMetaShape,
  stateCodeSchema,
  text,
  uuidSchema,
} from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { activeFilterSchema, checkGstinConsistency } from './shared.js';

export const PARTY_TYPES = ['customer', 'vendor', 'both'] as const;
export const partyTypeSchema = z.enum(PARTY_TYPES);
export type PartyType = z.infer<typeof partyTypeSchema>;

export const GST_REGISTRATION_TYPES = [
  'regular',
  'composition',
  'unregistered',
  'consumer',
  'overseas',
  'sez',
] as const;
export const gstRegistrationTypeSchema = z.enum(GST_REGISTRATION_TYPES);
export type GstRegistrationType = z.infer<typeof gstRegistrationTypeSchema>;

/** Registration types that hold a GSTIN; the others never do. */
export const GSTIN_REQUIRED_FOR: readonly GstRegistrationType[] = ['regular', 'composition', 'sez'];

export const ADDRESS_KINDS = ['billing', 'shipping'] as const;
export const addressKindSchema = z.enum(ADDRESS_KINDS);

const addressFields = {
  kind: addressKindSchema,
  label: text(50).nullable(),
  line1: text(200),
  line2: text(200).nullable(),
  city: text(100),
  /** Required for an Indian address (it decides the place of supply); null abroad. */
  stateCode: currentStateCodeSchema.nullable(),
  /** A 6-digit PIN in India; free-form (≤ 10) abroad. */
  pincode: z.string().trim().max(10).nullable(),
  country: countryCodeSchema,
  isDefault: z.boolean(),
};

type AddressRuleInput = z.output<z.ZodObject<typeof addressFields>>;

const addressRules = (value: AddressRuleInput, ctx: z.RefinementCtx): void => {
  if (value.country !== 'IN') {
    if (value.stateCode !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['stateCode'],
        message: 'A foreign address has no Indian state',
      });
    }
    return;
  }
  if (value.stateCode === null) {
    ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'Choose the state' });
  }
  if (value.pincode === null || !pincodeSchema.safeParse(value.pincode).success) {
    ctx.addIssue({ code: 'custom', path: ['pincode'], message: 'Enter a 6-digit pincode' });
  }
};

/** An address in a create or update payload. `id` keeps an existing address on update. */
export const partyAddressInputSchema = z
  .strictObject({
    id: uuidSchema.optional(),
    ...addressFields,
    label: addressFields.label.default(null),
    line2: addressFields.line2.default(null),
    stateCode: addressFields.stateCode.default(null),
    pincode: addressFields.pincode.default(null),
    country: countryCodeSchema.default('IN'),
    isDefault: z.boolean().default(false),
  })
  .superRefine(addressRules);
export type PartyAddressInput = z.input<typeof partyAddressInputSchema>;

export const partyAddressResponseSchema = z.object({
  id: uuidSchema,
  kind: addressKindSchema,
  label: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  stateCode: stateCodeSchema.nullable(),
  pincode: z.string().nullable(),
  country: z.string(),
  isDefault: z.boolean(),
});
export type PartyAddressResponse = z.infer<typeof partyAddressResponseSchema>;

const partyFields = {
  code: text(30),
  name: text(200),
  partyType: partyTypeSchema,
  gstRegistrationType: gstRegistrationTypeSchema,
  gstin: gstinSchema.nullable(),
  pan: panSchema.nullable(),
  /** Paise (the money type carries the unit). Null means no limit; `"0"` means cash only. */
  creditLimit: nonNegativeMoneySchema.nullable(),
  creditDays: z.int().min(0).max(999).nullable(),
  paymentTerms: text(200).nullable(),
  contactPerson: text(120).nullable(),
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  notes: text(1000).nullable(),
  isActive: z.boolean(),
  addresses: z.array(partyAddressInputSchema),
};

const partyRecordObject = z.object(partyFields);
type PartyRuleInput = z.output<typeof partyRecordObject>;

function checkAddresses(addresses: PartyRuleInput['addresses'], ctx: z.RefinementCtx): void {
  const defaults = (kind: string): number =>
    addresses.filter((a) => a.kind === kind && a.isDefault).length;
  if (defaults('billing') !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['addresses'],
      message: 'Mark exactly one billing address as default',
    });
  }
  if (defaults('shipping') > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['addresses'],
      message: 'Mark at most one shipping address as default',
    });
  }
}

/**
 * Party rules (spec 02): GSTIN required for regular, composition and SEZ and absent otherwise;
 * its state equals the default billing address state; its PAN equals `pan`; exactly one default
 * billing address and at most one default shipping address.
 */
const partyRules = (value: PartyRuleInput, ctx: z.RefinementCtx): void => {
  const { gstRegistrationType, gstin, pan, addresses } = value;
  const required = GSTIN_REQUIRED_FOR.includes(gstRegistrationType);
  if (required && gstin === null) {
    ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'A registered party needs a GSTIN' });
  }
  if (!required && gstin !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['gstin'],
      message: `A ${gstRegistrationType} party has no GSTIN`,
    });
  }
  checkAddresses(addresses, ctx);
  const billing = addresses.find((a) => a.kind === 'billing' && a.isDefault);
  checkGstinConsistency({ gstin, pan, stateCode: billing?.stateCode ?? null }, ctx);
};

/**
 * The whole party with its rules. `PATCH /parties/:id` parses
 * `partyRecordSchema.parse({ ...existing, ...patch })`; the stored addresses parse as input
 * addresses (they keep their `id`).
 */
export const partyRecordSchema = partyRecordObject.superRefine(partyRules);
export type PartyRecord = z.output<typeof partyRecordSchema>;

export const partyResponseSchema = z.object({
  ...recordMetaShape,
  code: z.string(),
  name: z.string(),
  partyType: partyTypeSchema,
  gstRegistrationType: gstRegistrationTypeSchema,
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  creditLimit: moneySchema.nullable(),
  creditDays: z.int().nullable(),
  paymentTerms: z.string().nullable(),
  contactPerson: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  addresses: z.array(partyAddressResponseSchema),
});
export type PartyResponse = z.infer<typeof partyResponseSchema>;

export const partyCreateSchema = z
  .strictObject({
    ...partyFields,
    // Unregistered, consumer and overseas parties have none (as on branches, absent means null).
    gstin: partyFields.gstin.default(null),
    pan: partyFields.pan.default(null),
    creditLimit: partyFields.creditLimit.default(null),
    creditDays: partyFields.creditDays.default(null),
    paymentTerms: partyFields.paymentTerms.default(null),
    contactPerson: partyFields.contactPerson.default(null),
    email: partyFields.email.default(null),
    phone: partyFields.phone.default(null),
    notes: partyFields.notes.default(null),
    isActive: z.boolean().default(true),
  })
  .superRefine(partyRules);
export type PartyCreate = z.infer<typeof partyCreateSchema>;
export type PartyCreateInput = z.input<typeof partyCreateSchema>;

/** `PATCH /parties/:id`. Sending `addresses` replaces the whole list. */
export const partyUpdateSchema = updateSchema(partyFields);
export type PartyUpdate = z.infer<typeof partyUpdateSchema>;

export const partyListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['code', 'name', 'createdAt']).optional(),
  type: partyTypeSchema.optional(),
  active: activeFilterSchema,
});
export type PartyListQuery = z.infer<typeof partyListQuerySchema>;
