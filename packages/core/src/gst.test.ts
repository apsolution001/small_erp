import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.js';
import { splitTax, supplyTypeFor, type TaxSplit } from './gst.js';
import { Money } from './money.js';

const paise = (s: TaxSplit): Record<keyof TaxSplit, bigint> => ({
  cgst: s.cgst.paise,
  sgst: s.sgst.paise,
  igst: s.igst.paise,
  cess: s.cess.paise,
  total: s.total.paise,
});

describe('splitTax', () => {
  it('splits an intra-state supply into equal CGST and SGST', () => {
    expect(
      paise(splitTax(Money.of(10000n), { rate: new Decimal('18'), supplyType: 'intra' })),
    ).toEqual({
      cgst: 900n,
      sgst: 900n,
      igst: 0n,
      cess: 0n,
      total: 1800n,
    });
  });

  it('charges the full rate as IGST on an inter-state supply', () => {
    expect(paise(splitTax(Money.of(10000n), { rate: '18', supplyType: 'inter' }))).toEqual({
      cgst: 0n,
      sgst: 0n,
      igst: 1800n,
      cess: 0n,
      total: 1800n,
    });
  });

  it('rounds CGST and SGST separately, so an odd half-rate can differ by 1 paise', () => {
    // ₹1.01 at 5%: 2.525 → 3 paise each (total 6), whereas 5% of 101 = 5.05 → 5.
    expect(paise(splitTax(Money.of(101n), { rate: '5', supplyType: 'intra' }))).toEqual({
      cgst: 3n,
      sgst: 3n,
      igst: 0n,
      cess: 0n,
      total: 6n,
    });
    expect(splitTax(Money.of(101n), { rate: '5', supplyType: 'inter' }).igst.paise).toBe(5n);
  });

  it('handles fractional slabs exactly', () => {
    const quarter = splitTax(Money.of(100000n), { rate: '0.25', supplyType: 'intra' });
    expect([quarter.cgst.paise, quarter.sgst.paise]).toEqual([125n, 125n]);
    const onePointFive = splitTax(Money.of(12345n), { rate: '1.5', supplyType: 'intra' });
    expect([onePointFive.cgst.paise, onePointFive.sgst.paise]).toEqual([93n, 93n]); // 92.5875
  });

  it('computes cess on the taxable value alongside GST', () => {
    expect(
      paise(splitTax(Money.of(100000n), { rate: '28', cess: '12', supplyType: 'inter' })),
    ).toEqual({
      cgst: 0n,
      sgst: 0n,
      igst: 28000n,
      cess: 12000n,
      total: 40000n,
    });
    expect(
      splitTax(Money.of(100n), { rate: '0', cess: '290', supplyType: 'intra' }).cess.paise,
    ).toBe(290n);
  });

  it('rounds negative (credit-note) lines symmetrically', () => {
    expect(paise(splitTax(Money.of(-101n), { rate: '5', supplyType: 'intra' }))).toEqual({
      cgst: -3n,
      sgst: -3n,
      igst: 0n,
      cess: 0n,
      total: -6n,
    });
  });

  it('defaults cess to zero when it is omitted', () => {
    expect(splitTax(Money.of(10000n), { rate: '18', supplyType: 'intra' }).cess.paise).toBe(0n);
  });

  it('returns zero tax for nil-rated lines', () => {
    expect(splitTax(Money.of(99999n), { rate: '0', supplyType: 'intra' }).total.isZero()).toBe(
      true,
    );
  });

  it('stays exact beyond 2^53 paise', () => {
    expect(splitTax(Money.of(2n ** 60n), { rate: '18', supplyType: 'inter' }).igst.paise).toBe(
      207525870829232456n,
    ); // …455.68
  });

  it('rejects out-of-range rates', () => {
    expect(() => splitTax(Money.of(1n), { rate: '-1', supplyType: 'intra' })).toThrow(RangeError);
    expect(() => splitTax(Money.of(1n), { rate: '100.0001', supplyType: 'intra' })).toThrow(
      RangeError,
    );
    expect(() => splitTax(Money.of(1n), { rate: '18', cess: '-0.5', supplyType: 'intra' })).toThrow(
      RangeError,
    );
  });
});

describe('supplyTypeFor', () => {
  it('is intra-state when the supplier state equals the place of supply', () => {
    expect(supplyTypeFor('27', '27')).toBe('intra');
    expect(supplyTypeFor('97', '97')).toBe('intra');
  });

  it('is inter-state when the states differ', () => {
    expect(supplyTypeFor('27', '29')).toBe('inter');
    expect(supplyTypeFor('27', '97')).toBe('inter');
  });

  it('treats zero-rated supplies (SEZ, export) as inter-state even within a state', () => {
    expect(supplyTypeFor('27', '27', { zeroRated: true })).toBe('inter');
    expect(supplyTypeFor('27', '27', { zeroRated: false })).toBe('intra');
  });

  it('treats place of supply 96 (Other Countries) as inter-state', () => {
    expect(supplyTypeFor('27', '96')).toBe('inter');
    expect(supplyTypeFor('27', '96', { zeroRated: false })).toBe('inter');
  });

  it('accepts place of supply 99 (Centre Jurisdiction), which is never a supplier state', () => {
    expect(supplyTypeFor('07', '99')).toBe('inter');
  });

  it('rejects 96 and 99 as the supplier state', () => {
    expect(() => supplyTypeFor('96', '27')).toThrow(RangeError);
    expect(() => supplyTypeFor('99', '99')).toThrow(RangeError);
  });

  it('rejects the legacy codes 25 and 28 on either side', () => {
    for (const legacy of ['25', '28']) {
      expect(() => supplyTypeFor(legacy, '27'), legacy).toThrow(RangeError);
      expect(() => supplyTypeFor('27', legacy), legacy).toThrow(RangeError);
    }
  });

  it('rejects unknown state codes', () => {
    expect(() => supplyTypeFor('98', '27')).toThrow(RangeError);
    expect(() => supplyTypeFor('27', 'MH')).toThrow(RangeError);
  });
});
