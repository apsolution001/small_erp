import { Fragment } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { formatHotkey, HOTKEY_GROUPS, useHotkeyList } from '@/lib/hotkeys';

/** The `?` dialog: every shortcut registered right now, by group (frontend standard). */
export function HotkeysHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hotkeys = useHotkeyList();
  const groups = HOTKEY_GROUPS.map((group) => ({
    group,
    entries: hotkeys.filter((h) => h.group === group),
  })).filter((g) => g.entries.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts available on this screen.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {groups.map(({ group, entries }) => (
            <section key={group} aria-labelledby={`hotkeys-${group}`}>
              <h3
                id={`hotkeys-${group}`}
                className="pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {group}
              </h3>
              <dl className="grid gap-1.5">
                {entries.map((hotkey) => (
                  <div key={hotkey.id} className="flex items-center justify-between gap-4 text-sm">
                    <dt>{hotkey.description}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {formatHotkey(hotkey.keys).map((combo, i) => (
                        <Fragment key={combo.join('+')}>
                          {i > 0 ? <span className="text-xs text-muted-foreground">or</span> : null}
                          {combo.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
