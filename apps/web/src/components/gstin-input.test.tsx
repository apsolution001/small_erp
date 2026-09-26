import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { checkGstin } from '@/lib/gstin';
import { GstinInput } from './gstin-input';

function Controlled({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="gstin">GSTIN</label>
      <GstinInput id="gstin" value={value} onValueChange={setValue} />
    </>
  );
}

describe('checkGstin', () => {
  it('tells each problem apart', () => {
    expect(checkGstin('')).toEqual({ status: 'empty' });
    expect(checkGstin('27AAPFU')).toEqual({ status: 'incomplete', remaining: 8 });
    expect(checkGstin('27AAPFU0939F1ZV')).toEqual({
      status: 'valid',
      stateCode: '27',
      stateName: 'Maharashtra',
    });
    expect(checkGstin('27AAPFU0939F1ZA')).toEqual({ status: 'invalid_checksum' });
    expect(checkGstin('27AAPF00939F1ZV')).toEqual({ status: 'invalid_format' });
    // 28 is the legacy Andhra Pradesh code: never on a new GSTIN, even with a good checksum.
    expect(checkGstin('28AAPFU0939F1ZT')).toEqual({ status: 'invalid_state', stateCode: '28' });
  });
});

describe('GstinInput', () => {
  it('upper-cases and strips spaces as you type, up to 15 characters', async () => {
    render(<Controlled />);
    const input = screen.getByLabelText('GSTIN');
    await userEvent.type(input, '27aapfu 0939f1zv99');
    expect(input).toHaveValue('27AAPFU0939F1ZV');
  });

  it('confirms a valid GSTIN with its state, linked to the field', async () => {
    render(<Controlled />);
    const input = screen.getByLabelText('GSTIN');
    await userEvent.type(input, '27AAPFU0939F1ZV');
    expect(input).toHaveAccessibleDescription('Valid GSTIN · 27 Maharashtra');
  });

  it('flags a wrong check character', () => {
    render(<Controlled initial="27AAPFU0939F1ZA" />);
    expect(screen.getByLabelText('GSTIN')).toHaveAccessibleDescription(
      'The check character does not match. Look for a typo',
    );
  });

  it('counts down while incomplete', async () => {
    render(<Controlled />);
    await userEvent.type(screen.getByLabelText('GSTIN'), '27AAPFU0939F1');
    expect(screen.getByText('2 more characters')).toBeInTheDocument();
  });
});
