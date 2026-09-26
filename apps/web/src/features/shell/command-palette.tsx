import { useNavigate } from '@tanstack/react-router';
import {
  Building2Icon,
  KeyboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { useAuth, usePermissionCheck } from '@/lib/auth';
import { useHotkey } from '@/lib/hotkeys';
import { useTheme } from '@/lib/theme/use-theme';
import { visibleNav } from './nav';
import { useShellUi } from './shell-ui-context';
import { useLogout, useSwitchTenant } from './use-session-actions';

/** Ctrl+K: jump to any screen the role may open, switch company, and account actions. */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setHelpOpen } = useShellUi();
  const { me, tenants } = useAuth();
  const can = usePermissionCheck();
  const navigate = useNavigate();
  const switchTenant = useSwitchTenant();
  const logout = useLogout();
  const { setPreference } = useTheme();

  useHotkey({
    id: 'app.palette',
    keys: 'mod+k',
    description: 'Open the command palette',
    group: 'General',
    handler: () => {
      setPaletteOpen(!paletteOpen);
    },
  });

  const run = (action: () => unknown) => {
    setPaletteOpen(false);
    action();
  };
  const screens = visibleNav(can).flatMap((group) =>
    group.items.flatMap((item) => (item.to === undefined ? [] : [{ ...item, to: item.to }])),
  );
  const otherTenants = tenants.filter((t) => t.tenantId !== me?.tenant.id);

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      title="Command palette"
      description="Search screens and actions"
    >
      <CommandInput placeholder="Go to a screen or run an action…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          {screens.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.id}
                value={`go ${item.label}`}
                keywords={[...(item.keywords ?? [])]}
                onSelect={() => {
                  run(() => navigate({ to: item.to }));
                }}
              >
                <Icon aria-hidden />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
        {otherTenants.length > 0 ? (
          <CommandGroup heading="Switch company">
            {otherTenants.map((tenant) => (
              <CommandItem
                key={tenant.tenantId}
                value={`switch ${tenant.name}`}
                keywords={['company', 'tenant', tenant.slug]}
                onSelect={() => {
                  run(() => {
                    switchTenant.mutate(tenant.tenantId);
                  });
                }}
              >
                <Building2Icon aria-hidden />
                {tenant.name}
                <CommandShortcut>{tenant.roleName}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Preferences">
          <CommandItem
            value="theme light"
            onSelect={() => {
              run(() => {
                setPreference('light');
              });
            }}
          >
            <SunIcon aria-hidden />
            Light theme
          </CommandItem>
          <CommandItem
            value="theme dark"
            onSelect={() => {
              run(() => {
                setPreference('dark');
              });
            }}
          >
            <MoonIcon aria-hidden />
            Dark theme
          </CommandItem>
          <CommandItem
            value="theme system"
            onSelect={() => {
              run(() => {
                setPreference('system');
              });
            }}
          >
            <MonitorIcon aria-hidden />
            Match system theme
          </CommandItem>
          <CommandItem
            value="keyboard shortcuts help"
            onSelect={() => {
              run(() => {
                setHelpOpen(true);
              });
            }}
          >
            <KeyboardIcon aria-hidden />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Account">
          <CommandItem
            value="log out sign out"
            onSelect={() => {
              run(() => {
                logout.mutate();
              });
            }}
          >
            <LogOutIcon aria-hidden />
            Log out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
