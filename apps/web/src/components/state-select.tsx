import { CURRENT_STATE_CODES, type CurrentStateCode, getState } from '@ekaro/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Current GST states and UTs only: the legacy codes 25 and 28 never go on a new address. */
const OPTIONS = CURRENT_STATE_CODES.map((code) => ({
  code,
  label: `${code} · ${getState(code)?.name ?? code}`,
}));

function isCurrentCode(value: string): value is CurrentStateCode {
  return OPTIONS.some((o) => o.code === value);
}

export interface StateSelectProps {
  id?: string;
  /** A current state code, or `''` for none. */
  value: CurrentStateCode | '';
  onValueChange: (value: CurrentStateCode) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string | undefined;
}

/** State / UT picker by GST state code. Type a code or a name to jump to it. */
export function StateSelect({
  id,
  value,
  onValueChange,
  onBlur,
  placeholder = 'Select state',
  disabled,
  className,
  ...aria
}: StateSelectProps) {
  return (
    <Select
      value={value}
      disabled={disabled ?? false}
      onValueChange={(next) => {
        if (isCurrentCode(next)) onValueChange(next);
      }}
      onOpenChange={(open) => {
        if (!open) onBlur?.();
      }}
    >
      <SelectTrigger id={id} className={cn('w-full', className)} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {OPTIONS.map((o) => (
          <SelectItem key={o.code} value={o.code}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
