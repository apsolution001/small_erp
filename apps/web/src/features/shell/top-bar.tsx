import { formatDate } from '@/lib/format';
import { MenuIcon, PanelLeftIcon, SearchIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth } from '@/lib/auth';
import { formatKeys } from '@/lib/hotkeys';
import { AppNav } from './app-sidebar';
import { FyBadge } from './fy-badge';
import { useShellUi } from './shell-ui-context';
import { TenantSwitcher } from './tenant-switcher';
import { UserMenu } from './user-menu';

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { me } = useAuth();
  const { setPaletteOpen } = useShellUi();
  const trialEndsAt = me?.tenant.status === 'trial' ? me.tenant.trialEndsAt : null;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="hidden md:inline-flex"
        aria-label="Toggle sidebar"
        title="Toggle sidebar (Ctrl+B)"
        onClick={onToggleSidebar}
      >
        <PanelLeftIcon aria-hidden />
      </Button>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open menu">
            <MenuIcon aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="px-4 pt-4 text-primary">Ekaro</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <AppNav />
        </SheetContent>
      </Sheet>
      <TenantSwitcher />
      <FyBadge />
      {trialEndsAt === null ? null : (
        <Badge
          variant="outline"
          className="hidden font-normal text-muted-foreground lg:inline-flex"
        >
          Trial ends {formatDate(trialEndsAt)}
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="w-64 justify-start gap-2 pr-1.5 text-muted-foreground max-sm:w-auto"
          onClick={() => {
            setPaletteOpen(true);
          }}
        >
          <SearchIcon aria-hidden />
          <span className="truncate max-sm:sr-only">Go to a screen…</span>
          <span className="ml-auto flex gap-0.5 max-sm:hidden">
            {formatKeys('mod+k').map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}
