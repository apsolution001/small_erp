import { useMemo } from 'react';
import { moneyCodec } from '@/lib/numeric-codecs';
import { NumericInput, type NumericInputProps } from './numeric-input';

export type MoneyInputProps = Omit<NumericInputProps, 'codec' | 'prefix'> & {
  /** Credit notes and adjustments may go below zero; prices and amounts may not (default). */
  allowNegative?: boolean;
};

/**
 * Money entry (frontend standard): the user types rupees (`12345.5`), the value is integer
 * paise as a string (`"1234550"`), `''` when empty. Conversion goes through `Money` only.
 */
export function MoneyInput({ allowNegative = false, ...props }: MoneyInputProps) {
  const codec = useMemo(() => moneyCodec(allowNegative), [allowNegative]);
  return <NumericInput {...props} codec={codec} prefix="₹" />;
}
