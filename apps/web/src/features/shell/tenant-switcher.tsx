import { Building2Icon, CheckIcon, ChevronsUpDownIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth';
import { useSwitchTenant } from './use-session-actions';

/** The current company, and the user's other companies to switch to. */
export function TenantSwitcher() {
  const { me, tenants } = useAuth();
  const switchTenant = useSwitchTenant();
  if (me === undefined) return null;
  const current = me.tenant;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="max-w-64 gap-2 px-2 font-medium"
          aria-label={`Company: ${current.name}. Switch company`}
          disabled={switchTenant.isPending}
        >
          {switchTenant.isPending ? (
            <Loader2Icon aria-hidden className="animate-spin" />
          ) : (
            <Building2Icon aria-hidden className="text-muted-foreground" />
          )}
          <span className="truncate">{current.name}</span>
          <ChevronsUpDownIcon aria-hidden className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Companies
        </DropdownMenuLabel>
        {tenants.map((tenant) => {
          const isCurrent = tenant.tenantId === current.id;
          return (
            <DropdownMenuItem
              key={tenant.tenantId}
              disabled={isCurrent}
              onSelect={() => {
                switchTenant.mutate(tenant.tenantId);
              }}
              className="gap-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{tenant.name}</span>
                <span className="text-xs text-muted-foreground">{tenant.roleName}</span>
              </span>
              {isCurrent ? <CheckIcon aria-label="Current company" /> : null}
            </DropdownMenuItem>
          );
        })}
        {tenants.length <= 1 ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Companies you are invited to appear here.
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
