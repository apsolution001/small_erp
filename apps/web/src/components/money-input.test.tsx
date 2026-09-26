import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MoneyInput } from './money-input';
import { QtyInput } from './qty-input';

function ControlledMoney({
  initial = '',
  onValue,
  allowNegative,
}: {
  initial?: string;
  onValue: (v: string) => void;
  allowNegative?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="amount">Amount</label>
      <MoneyInput
        id="amount"
        value={value}
        allowNegative={allowNegative ?? false}
        onValueChange={(v) => {
          setValue(v);
          onValue(v);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setValue('');
        }}
      >
        Reset
      </button>
      <output>{value}</output>
    </>
  );
}

describe('MoneyInput', () => {
  it('turns typed rupees into a paise string, digit by digit', async () => {
    const onValue = vi.fn();
    render(<ControlledMoney onValue={onValue} />);
    await userEvent.type(screen.getByLabelText('Amount'), '12345.5');

    expect(onValue.mock.calls.map(([v]) => v as string)).toEqual([
      '100',
      '1200',
      '12300',
      '123400',
      '1234500',
      // `12345.` is the same amount, so no change is reported
      '1234550',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('1234550');
  });

  it('keeps every paisa of amounts too large for a float', async () => {
    const onValue = vi.fn();
    render(<ControlledMoney onValue={onValue} />);
    await userEvent.type(screen.getByLabelText('Amount'), '999999999999999.99');
    expect(onValue).toHaveBeenLastCalledWith('99999999999999999');
  });

  it('refuses a third decimal, letters and (by default) a minus sign', async () => {
    const onValue = vi.fn();
    render(<ControlledMoney onValue={onValue} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '-1a2.345');
    expect(input).toHaveValue('12.34');
    expect(onValue).toHaveBeenLastCalledWith('1234');
  });

  it('allows negatives when asked', async () => {
    const onValue = vi.fn();
    render(<ControlledMoney onValue={onValue} allowNegative />);
    await userEvent.type(screen.getByLabelText('Amount'), '-0.5');
    expect(onValue).toHaveBeenLastCalledWith('-50');
  });

  it('shows Indian grouping with two decimals when not focused, and plain digits when editing', async () => {
    render(<ControlledMoney initial="123456750" onValue={vi.fn()} />);
    const input = screen.getByLabelText('Amount');
    expect(input).toHaveValue('12,34,567.50');
    await userEvent.click(input);
    expect(input).toHaveValue('1234567.50');
    await userEvent.tab();
    expect(input).toHaveValue('12,34,567.50');
  });

  it('accepts pasted grouped amounts', async () => {
    const onValue = vi.fn();
    render(<ControlledMoney onValue={onValue} />);
    await userEvent.click(screen.getByLabelText('Amount'));
    await userEvent.paste('1,23,456.78');
    expect(onValue).toHaveBeenLastCalledWith('12345678');
  });

  it('clears to an empty string and follows an outside reset', async () => {
    const onValue = vi.fn();
    render(<ControlledMoney initial="500" onValue={onValue} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(input).toHaveValue('');
    await userEvent.type(input, '7');
    await userEvent.clear(input);
    expect(onValue).toHaveBeenLastCalledWith('');
  });
});

describe('QtyInput', () => {
  function ControlledQty({
    decimals,
    onValue,
  }: {
    decimals: number;
    onValue: (v: string) => void;
  }) {
    const [value, setValue] = useState('');
    return (
      <>
        <label htmlFor="qty">Qty</label>
        <QtyInput
          id="qty"
          decimals={decimals}
          value={value}
          onValueChange={(v) => {
            setValue(v);
            onValue(v);
          }}
        />
      </>
    );
  }

  it('limits decimals to the unit and reports canonical decimal text', async () => {
    const onValue = vi.fn();
    render(<ControlledQty decimals={3} onValue={onValue} />);
    const input = screen.getByLabelText('Qty');
    await userEvent.type(input, '0012.34567');
    expect(onValue).toHaveBeenLastCalledWith('12.345');
    await userEvent.tab();
    expect(input).toHaveValue('12.345');
  });

  it('takes whole numbers only for a 0-decimal unit, grouped when not focused', async () => {
    const onValue = vi.fn();
    render(<ControlledQty decimals={0} onValue={onValue} />);
    const input = screen.getByLabelText('Qty');
    await userEvent.type(input, '150000.5');
    expect(onValue).toHaveBeenLastCalledWith('1500005');
    await userEvent.tab();
    expect(input).toHaveValue('15,00,005');
  });
});
