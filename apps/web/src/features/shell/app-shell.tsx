import { Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import { useHotkey } from '@/lib/hotkeys';
import { AppSidebar } from './app-sidebar';
import { CommandPalette } from './command-palette';
import { TopBar } from './top-bar';

const COLLAPSED_KEY = 'ekaro.sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** The signed-in frame: collapsible sidebar, top bar, the page, and the command palette. */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleSidebar = () => {
    setCollapsed((was) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(!was));
      } catch {
        // A per-device preference; without storage it lasts until reload.
      }
      return !was;
    });
  };
  useHotkey({
    id: 'app.sidebar',
    keys: 'mod+b',
    description: 'Collapse or expand the sidebar',
    group: 'Navigation',
    handler: toggleSidebar,
  });

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <AppSidebar collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onToggleSidebar={toggleSidebar} />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
