import { type TenantSelectionResponse } from '@ekaro/contracts';
import { Building2Icon, ChevronRightIcon, Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';

export interface TenantPickerProps {
  selection: TenantSelectionResponse;
  /** Back to the login form, with a notice (empty for none). */
  onRestart: (message: string) => void;
}

/** Why the selection failed, for the login page the user goes back to. */
function restartMessage(error: unknown): string {
  if (isApiError(error) && (error.code === 'TOKEN_EXPIRED' || error.code === 'TOKEN_INVALID')) {
    return 'That took too long. Sign in again to choose a company.';
  }
  return `${errorMessage(error)} Sign in again to choose a company.`;
}

/**
 * Second login step for a user with several companies (spec 01 §3.2). The selection token is
 * single-use and lasts 5 minutes, so any failed attempt goes back to login: a retry with the
 * same token would only be refused.
 */
export function TenantPicker({ selection, onRestart }: TenantPickerProps) {
  const { controller } = useAuth();
  const [pending, setPending] = useState<string | null>(null);

  const choose = async (tenantId: string) => {
    setPending(tenantId);
    try {
      await controller.selectTenant({ selectionToken: selection.selectionToken, tenantId });
    } catch (error) {
      onRestart(restartMessage(error));
    }
  };

  return (
    <div className="grid gap-3">
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
        disabled={pending !== null}
        onClick={() => {
          onRestart('');
        }}
      >
        Use a different account
      </Button>
    </div>
  );
}
