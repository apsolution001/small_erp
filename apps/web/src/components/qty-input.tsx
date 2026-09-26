import { useMemo } from 'react';
import { qtyCodec } from '@/lib/numeric-codecs';
import { NumericInput, type NumericInputProps } from './numeric-input';

export type QtyInputProps = Omit<NumericInputProps, 'codec' | 'prefix'> & {
  /** The unit's decimal places (0 for NOS, 3 for KGS); more cannot be typed. */
  decimals: number;
  /** Stock adjustments may be negative; document lines may not (default). */
  allowNegative?: boolean;
};

/** Quantity entry: the value is a decimal string that fits `numeric(20,6)`, `''` when empty. */
export function QtyInput({ decimals, allowNegative = false, ...props }: QtyInputProps) {
  const codec = useMemo(() => qtyCodec(decimals, allowNegative), [decimals, allowNegative]);
  return <NumericInput {...props} codec={codec} />;
}
