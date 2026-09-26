import { type ComponentProps, type ReactNode, useState } from 'react';
import { Input } from '@/components/ui/input';
import { type NumericCodec } from '@/lib/numeric-codecs';
import { cn } from '@/lib/utils';

export type NumericInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> & {
  value: string;
  onValueChange: (value: string) => void;
  codec: NumericCodec;
  /** Shown inside the field on the left (`₹`). */
  prefix?: ReactNode;
};

/**
 * A right-aligned text field for amounts and quantities: plain digits while editing, grouped
 * when not focused. It keeps its own draft (`12.`) and reports only whole values upward, as
 * strings: no JS number ever carries the value.
 */
export function NumericInput({
  value,
  onValueChange,
  codec,
  prefix,
  className,
  onFocus,
  onBlur,
  ...props
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => codec.toDraft(value));
  const [focused, setFocused] = useState(false);

  // The value changed from outside (form reset, server data): start the draft over from it.
  // Adjusting state during render is React's pattern for this; no effect is needed.
  const synced = codec.toDraft(value);
  if (codec.toValue(draft) !== value && draft !== synced) setDraft(synced);

  const handleChange = (raw: string) => {
    const next = raw.replaceAll(',', '').trim();
    if (!codec.accepts.test(next)) return;
    setDraft(next);
    const nextValue = codec.toValue(next);
    if (nextValue !== value) onValueChange(nextValue);
  };

  return (
    <div className="relative">
      {prefix === undefined ? null : (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          {prefix}
        </span>
      )}
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('text-right tabular-nums', prefix !== undefined && 'pl-7', className)}
        value={focused ? draft : value === '' ? '' : codec.display(value)}
        onChange={(e) => {
          handleChange(e.target.value);
        }}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          setDraft(codec.toDraft(value));
          onBlur?.(e);
        }}
      />
    </div>
  );
}
