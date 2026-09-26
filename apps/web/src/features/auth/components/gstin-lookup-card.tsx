import { type GstinLookupResponse } from '@ekaro/contracts';
import { getState } from '@ekaro/core';
import { Building2Icon, CircleAlertIcon, Loader2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { errorMessage } from '@/lib/api-error';

export interface GstinLookupCardProps {
  data: GstinLookupResponse | undefined;
  isFetching: boolean;
  error: unknown;
}

/** The registration the GST portal holds for the GSTIN: what the company is created from. */
export function GstinLookupCard({ data, isFetching, error }: GstinLookupCardProps) {
  if (isFetching) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon aria-hidden className="size-4 animate-spin" />
        Looking up the GST portal…
      </p>
    );
  }
  if (error !== null && error !== undefined) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {errorMessage(error)}
      </p>
    );
  }
  if (data === undefined) return null;

  const active = data.status === 'Active';
  const { address } = data;
  return (
    <section
      aria-label="GST registration"
      className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <Building2Icon aria-hidden className="size-4 text-muted-foreground" />
          {data.legalName}
        </p>
        <Badge variant={active ? 'success' : 'warning'}>{data.status}</Badge>
      </div>
      {data.tradeName === null ? null : (
        <p className="text-muted-foreground">Trade name: {data.tradeName}</p>
      )}
      <p className="text-muted-foreground">
        {address.line1}, {address.city} {address.pincode} ·{' '}
        <span className="text-foreground">{getState(data.stateCode)?.name ?? data.stateCode}</span>
      </p>
      {active ? null : (
        <p role="alert" className="pt-1 text-sm font-medium text-destructive">
          This GSTIN is {data.status.toLowerCase()} on the GST portal. Only an active registration
          can open an Ekaro company.
        </p>
      )}
    </section>
  );
}
