import { Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissionCheck } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { type NavItem, visibleNav } from './nav';

const itemClass =
  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-sidebar-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0';

function NavEntry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const body = item.to ? (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      className={cn(
        itemClass,
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground',
        collapsed && 'justify-center px-0',
      )}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon aria-hidden />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  ) : (
    <span
      aria-disabled="true"
      aria-label={collapsed ? `${item.label} (coming soon)` : undefined}
      className={cn(itemClass, 'cursor-default opacity-55', collapsed && 'justify-center px-0')}
    >
      <Icon aria-hidden />
      {collapsed ? null : (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            Soon
          </Badge>
        </>
      )}
    </span>
  );

  if (!collapsed) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {item.to ? '' : ' · soon'}
      </TooltipContent>
    </Tooltip>
  );
}

/** The app navigation, filtered to what the role may see (`useCan`). */
export function AppNav({ collapsed = false }: { collapsed?: boolean }) {
  const can = usePermissionCheck();
  const groups = visibleNav(can);
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 px-2 py-3">
      {groups.map((group) => (
        <div key={group.id} className="grid gap-0.5">
          {group.label === null ? null : collapsed ? (
            <div aria-hidden className="mx-2 my-1 h-px bg-sidebar-border" />
          ) : (
            <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
          )}
          <ul className="grid gap-0.5" aria-label={group.label ?? undefined}>
            {group.items.map((item) => (
              <li key={item.id}>
                <NavEntry item={item} collapsed={collapsed} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      <div
        className={cn(
          'flex h-12 shrink-0 items-center border-b border-sidebar-border px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="text-lg font-semibold tracking-tight text-primary">
          {collapsed ? 'E' : 'Ekaro'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AppNav collapsed={collapsed} />
      </div>
    </aside>
  );
}
