import { currentFy, fyRange } from '@ekaro/core';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDate } from '@/lib/format';

/** The financial year the user is working in (Indian FY, April–March, read in IST). */
export function FyBadge({ now }: { now?: Date }) {
  const fy = currentFy(now);
  const { start, end } = fyRange(fy);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" tabIndex={0} className="tabular-nums">
          FY {fy}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Financial year {formatDate(start)} to {formatDate(end)}
      </TooltipContent>
    </Tooltip>
  );
}
