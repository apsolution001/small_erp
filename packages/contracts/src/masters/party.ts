import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import {
  countryCodeSchema,
  emailSchema,
  gstinSchema,
  nonNegativeMoneySchema,
  panSchema,
  phoneSchema,
  pincodeSchema,
  recordMetaShape,
  stateCodeSchema,
  text,
  uuidSchema,
  versionSchema,
} from '../common/primitives.js';
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
  stateCode: stateCodeSchema.nullable(),
  /** A 6-digit PIN in India; free-form (≤ 10) abroad. */
  pincode: z.string().trim().max(10).nullable(),
  country: countryCodeSchema,
  isDefault: z.boolean(),
};

type AddressRuleInput = z.infer<z.ZodObject<typeof addressFields>>;

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
  .object({
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

export const partyAddressResponseSchema = z.object({ id: uuidSchema, ...addressFields });
export type PartyAddressResponse = z.infer<typeof partyAddressResponseSchema>;

const partyFields = {
  code: text(30),
  name: text(200),
  partyType: partyTypeSchema,
  gstRegistrationType: gstRegistrationTypeSchema,
  gstin: gstinSchema.nullable(),
  pan: panSchema.nullable(),
  /** Paise. Null means no limit; `"0"` means cash only. */
  creditLimitPaise: nonNegativeMoneySchema.nullable(),
  creditDays: z.int().min(0).max(999).nullable(),
  paymentTerms: text(200).nullable(),
  contactPerson: text(120).nullable(),
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  notes: text(1000).nullable(),
  isActive: z.boolean(),
  addresses: z.array(partyAddressInputSchema),
};

/** Every field optional: the rules run on creates and on partial updates alike. */
const partyPatchSchema = z.object(partyFields).partial();
type PartyRuleInput = z.output<typeof partyPatchSchema>;

function checkAddresses(
  addresses: readonly { kind: string; isDefault: boolean }[],
  ctx: z.RefinementCtx,
): void {
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
 * billing address. Each runs only when its fields are present (the service checks a PATCH's
 * merged record).
 */
const partyRules = (value: PartyRuleInput, ctx: z.RefinementCtx): void => {
  const { gstRegistrationType, gstin, addresses } = value;
  if (gstRegistrationType !== undefined && gstin !== undefined) {
    const required = GSTIN_REQUIRED_FOR.includes(gstRegistrationType);
    if (required && gstin === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: 'A registered party needs a GSTIN',
      });
    }
    if (!required && gstin !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: `A ${gstRegistrationType} party has no GSTIN`,
      });
    }
  }
  if (addresses !== undefined) checkAddresses(addresses, ctx);
  const billingState = addresses?.find((a) => a.kind === 'billing' && a.isDefault)?.stateCode;
  checkGstinConsistency(value, billingState, ctx);
};

export const partyResponseSchema = z.object({
  ...recordMetaShape,
  ...partyFields,
  addresses: z.array(partyAddressResponseSchema),
});
export type PartyResponse = z.infer<typeof partyResponseSchema>;

export const partyCreateSchema = z
  .object({
    ...partyFields,
    pan: partyFields.pan.default(null),
    creditLimitPaise: partyFields.creditLimitPaise.default(null),
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
export const partyUpdateSchema = partyPatchSchema
  .extend({ version: versionSchema })
  .superRefine(partyRules);
export type PartyUpdate = z.infer<typeof partyUpdateSchema>;

export const partyListQuerySchema = paginationQuerySchema.extend({
  type: partyTypeSchema.optional(),
  active: activeFilterSchema,
});
export type PartyListQuery = z.infer<typeof partyListQuerySchema>;
