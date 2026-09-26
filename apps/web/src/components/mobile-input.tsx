import { type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const PREFIX = '+91';

export type MobileInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> & {
  /** E.164 as the API takes it (`+919876543210`), `''` when empty. */
  value: string;
  onValueChange: (value: string) => void;
};

/** An Indian mobile number: the user types 10 digits after a fixed `+91`. */
export function MobileInput({ value, onValueChange, className, ...props }: MobileInputProps) {
  const digits = value.startsWith(PREFIX) ? value.slice(PREFIX.length) : value;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
        {PREFIX}
      </span>
      <Input
        {...props}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={10}
        className={cn('pl-11 tabular-nums', className)}
        value={digits}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 10);
          onValueChange(next === '' ? '' : `${PREFIX}${next}`);
        }}
      />
    </div>
  );
}
