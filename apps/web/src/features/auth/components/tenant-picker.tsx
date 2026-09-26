import { type TenantSelectionResponse } from '@ekaro/contracts';
import { Building2Icon, ChevronRightIcon, Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';

export interface TenantPickerProps {
  selection: TenantSelectionResponse;
  /** The selection token expired (5 minutes): sign in again. */
  onRestart: (message: string) => void;
}

/** Second login step for a user with several companies (spec 01 §3.2). */
export function TenantPicker({ selection, onRestart }: TenantPickerProps) {
  const { controller } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (tenantId: string) => {
    setPending(tenantId);
    setError(null);
    try {
      await controller.selectTenant({ selectionToken: selection.selectionToken, tenantId });
    } catch (e) {
      if (isApiError(e) && (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID')) {
        onRestart('That took too long. Sign in again to choose a company.');
        return;
      }
      setError(isApiError(e) ? e.message : 'Could not open that company. Try again.');
      setPending(null);
    }
  };

  return (
    <div className="grid gap-3">
      <FormAlert message={error} />
      <ul className="grid gap-2" aria-label="Your companies">
        {selection.tenants.map((tenant, index) => (
          <li key={tenant.tenantId}>
            <Button
              type="button"
              variant="outline"
              autoFocus={index === 0}
              disabled={pending !== null}
              className="h-auto w-full justify-start gap-3 py-2.5 text-left"
              onClick={() => void choose(tenant.tenantId)}
            >
              <Building2Icon aria-hidden className="text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{tenant.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{tenant.roleName}</span>
              </span>
              {pending === tenant.tenantId ? (
                <Loader2Icon aria-label="Opening" className="animate-spin" />
              ) : (
                <ChevronRightIcon aria-hidden className="text-muted-foreground" />
              )}
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="link"
        className="justify-self-center"
        onClick={() => {
          onRestart('');
        }}
      >
        Use a different account
      </Button>
    </div>
  );
}
