import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import {
  countryCodeSchema,
  emailSchema,
  fyLabelSchema,
  gstinSchema,
  isoDateSchema,
  mobileSchema,
  moneySchema,
  nonNegativeQtySchema,
  nonNegativeMoneySchema,
  panSchema,
  percentSchema,
  phoneSchema,
  pincodeSchema,
  positiveQtySchema,
  qtySchema,
  rateSchema,
  stateCodeSchema,
  text,
  timestampSchema,
  uuidSchema,
} from './primitives.js';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean =>
  schema.safeParse(v).success;

describe('uuidSchema', () => {
  it('accepts uuidv7 and rejects garbage', () => {
    expect(ok(uuidSchema, uuidv7())).toBe(true);
    expect(ok(uuidSchema, 'not-a-uuid')).toBe(false);
  });
});

describe('moneySchema (paise string)', () => {
  it('accepts integer paise strings, including negatives and values beyond 2^53', () => {
    for (const v of ['0', '1234550', '-5', '9223372036854775807', '-9223372036854775808']) {
      expect(ok(moneySchema, v), v).toBe(true);
    }
  });

  it('rejects decimals, numbers, blanks and values outside Postgres bigint', () => {
    for (const v of ['1.5', '', ' 1', '1e3', '+1', 1234, null, '9223372036854775808']) {
      expect(ok(moneySchema, v), String(v)).toBe(false);
    }
    expect(ok(moneySchema, '-9223372036854775809')).toBe(false);
  });

  it('has a non-negative variant for limits', () => {
    expect(ok(nonNegativeMoneySchema, '0')).toBe(true);
    expect(ok(nonNegativeMoneySchema, '-1')).toBe(false);
  });
});

describe('qty / rate schemas', () => {
  it('accept decimal strings with at most 6 places, as numeric(20,6)', () => {
    expect(qtySchema.parse('50.000000')).toBe('50.000000'); // preserved exactly
    expect(ok(qtySchema, '-12.5')).toBe(true);
    expect(ok(qtySchema, '1.0000001')).toBe(false);
    expect(ok(qtySchema, '100000000000000')).toBe(false);
    expect(ok(qtySchema, 1.5)).toBe(false);
    expect(ok(rateSchema, '0.4575')).toBe(true);
    expect(ok(rateSchema, '-1')).toBe(false);
  });

  it('non-negative quantity allows zero but not negatives', () => {
    expect(ok(nonNegativeQtySchema, '0')).toBe(true);
    expect(ok(nonNegativeQtySchema, '-0.5')).toBe(false);
  });

  it('positive quantity rejects zero and negatives', () => {
    expect(ok(positiveQtySchema, '0.000001')).toBe(true);
    expect(ok(positiveQtySchema, '0')).toBe(false);
    expect(ok(positiveQtySchema, '0.000000')).toBe(false);
    expect(ok(positiveQtySchema, '-1')).toBe(false);
  });
});

describe('percentSchema', () => {
  it('accepts numeric(7,4) non-negative percentages', () => {
    for (const v of ['0', '18', '0.25', '1.5', '290', '999.9999'])
      expect(ok(percentSchema, v), v).toBe(true);
    for (const v of ['-1', '1000', '1.23456', '18%', 18])
      expect(ok(percentSchema, v), String(v)).toBe(false);
  });
});

describe('gstinSchema', () => {
  it('normalises case and whitespace, then validates the checksum', () => {
    expect(gstinSchema.parse(' 27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(ok(gstinSchema, '29AAGCB7383J1Z4')).toBe(true);
    expect(ok(gstinSchema, '27AAPFU0939F1ZA')).toBe(false);
    const issue = gstinSchema.safeParse('27AAPFU0939F1ZA').error?.issues[0];
    expect(issue?.message).toBe('Invalid GSTIN');
  });
});

describe('panSchema', () => {
  it('normalises and validates the PAN format', () => {
    expect(panSchema.parse('aapfu0939f')).toBe('AAPFU0939F');
    expect(ok(panSchema, 'AAPFU0939')).toBe(false);
    expect(ok(panSchema, '1APFU0939F')).toBe(false);
  });
});

describe('stateCodeSchema', () => {
  it('accepts GST state codes only', () => {
    expect(ok(stateCodeSchema, '27')).toBe(true);
    expect(ok(stateCodeSchema, '97')).toBe(true);
    expect(ok(stateCodeSchema, '99')).toBe(false);
    expect(ok(stateCodeSchema, 27)).toBe(false);
  });
});

describe('contact schemas', () => {
  it('pincode is 6 digits not starting with 0', () => {
    expect(ok(pincodeSchema, '400001')).toBe(true);
    for (const v of ['040001', '40001', '4000011', 'ABCDEF'])
      expect(ok(pincodeSchema, v), v).toBe(false);
  });

  it('mobile is E.164 +91 with a 6-9 leading digit', () => {
    expect(ok(mobileSchema, '+919876543210')).toBe(true);
    for (const v of ['9876543210', '+915876543210', '+91987654321', '+91 9876543210']) {
      expect(ok(mobileSchema, v), v).toBe(false);
    }
  });

  it('phone is E.164 +91 and also allows landlines', () => {
    expect(ok(phoneSchema, '+912224567890')).toBe(true);
    expect(ok(phoneSchema, '+919876543210')).toBe(true);
    expect(ok(phoneSchema, '+910224567890')).toBe(false);
  });

  it('email is trimmed and lower-cased', () => {
    expect(emailSchema.parse('  Owner@Example.COM ')).toBe('owner@example.com');
    expect(ok(emailSchema, 'not-an-email')).toBe(false);
  });

  it('country is an upper-case ISO 3166-1 alpha-2 code', () => {
    expect(ok(countryCodeSchema, 'IN')).toBe(true);
    expect(ok(countryCodeSchema, 'in')).toBe(false);
    expect(ok(countryCodeSchema, 'IND')).toBe(false);
  });
});

describe('text', () => {
  it('trims and bounds the length', () => {
    expect(text(5).parse('  Pune ')).toBe('Pune');
    expect(ok(text(5), '   ')).toBe(false);
    expect(ok(text(5), 'Mumbai')).toBe(false);
  });
});

describe('date schemas', () => {
  it('isoDate is a real calendar date', () => {
    expect(ok(isoDateSchema, '2026-04-01')).toBe(true);
    expect(ok(isoDateSchema, '2026-02-30')).toBe(false);
  });

  it('timestamp is ISO 8601 with an offset', () => {
    expect(ok(timestampSchema, '2026-09-26T10:00:00.000Z')).toBe(true);
    expect(ok(timestampSchema, '2026-09-26T15:30:00+05:30')).toBe(true);
    expect(ok(timestampSchema, '2026-09-26')).toBe(false);
  });

  it('fyLabel is YYYY-YY with consecutive years', () => {
    expect(ok(fyLabelSchema, '2026-27')).toBe(true);
    expect(ok(fyLabelSchema, '2026-28')).toBe(false);
  });
});
