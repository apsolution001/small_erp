import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { type ComponentProps, useId } from 'react';
import { Input } from '@/components/ui/input';
import { checkGstin, GSTIN_LENGTH, gstinCheckMessage, normalizeGstin } from '@/lib/gstin';
import { cn } from '@/lib/utils';

export type GstinInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'maxLength'
> & {
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * GSTIN entry: upper-case as you type, and live checksum feedback. The status line is linked
 * through `aria-describedby` and pairs an icon with text, so colour is never the only signal.
 */
export function GstinInput({
  value,
  onValueChange,
  className,
  id,
  'aria-describedby': describedBy,
  ...props
}: GstinInputProps) {
  const fallbackId = useId();
  const statusId = `${id ?? fallbackId}-gstin-status`;
  const check = checkGstin(value);
  const invalid = ['invalid_format', 'invalid_state', 'invalid_checksum'].includes(check.status);

  return (
    <div className="grid gap-1">
      <Input
        {...props}
        id={id}
        type="text"
        value={value}
        maxLength={GSTIN_LENGTH}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-describedby={cn(describedBy, statusId)}
        className={cn('font-mono tracking-wider uppercase', className)}
        onChange={(e) => {
          onValueChange(normalizeGstin(e.target.value));
        }}
      />
      <p
        id={statusId}
        aria-live="polite"
        className={cn(
          'flex items-center gap-1 text-xs',
          check.status === 'valid' && 'text-success',
          invalid && 'text-destructive',
          !invalid && check.status !== 'valid' && 'text-muted-foreground',
        )}
      >
        {check.status === 'valid' ? <CircleCheckIcon aria-hidden className="size-3.5" /> : null}
        {invalid ? <CircleAlertIcon aria-hidden className="size-3.5" /> : null}
        {gstinCheckMessage(check)}
      </p>
    </div>
  );
}
