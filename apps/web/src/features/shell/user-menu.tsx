import { KeyboardIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth';
import { THEME_PREFERENCES } from '@/lib/theme/theme-store';
import { useTheme } from '@/lib/theme/use-theme';
import { useShellUi } from './shell-ui-context';
import { useLogout } from './use-session-actions';

const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'System' } as const;
const THEME_ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Who is signed in (and as what role), theme, shortcuts, and log out. */
export function UserMenu() {
  const { me } = useAuth();
  const { setHelpOpen } = useShellUi();
  const { preference, setPreference } = useTheme();
  const logout = useLogout();
  if (me === undefined) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={`Account: ${me.user.fullName}`}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            {initials(me.user.fullName)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{me.user.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
          <p className="pt-1 text-xs text-muted-foreground">{me.membership.role.name}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setHelpOpen(true);
          }}
        >
          <KeyboardIcon aria-hidden />
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            const next = THEME_PREFERENCES.find((p) => p === value);
            if (next) setPreference(next);
          }}
        >
          {THEME_PREFERENCES.map((pref) => {
            const Icon = THEME_ICONS[pref];
            return (
              <DropdownMenuRadioItem key={pref} value={pref}>
                <Icon aria-hidden />
                {THEME_LABELS[pref]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={logout.isPending}
          onSelect={() => {
            logout.mutate();
          }}
        >
          <LogOutIcon aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
