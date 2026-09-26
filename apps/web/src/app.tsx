import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Loader2Icon, WifiOffIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type ApiClient } from '@/lib/api-client';
import { AuthProvider, useAuth } from '@/lib/auth';
import { type AuthController } from '@/lib/auth/auth-controller';
import { type HotkeyRegistry, HotkeysProvider } from '@/lib/hotkeys';
import { type RouterContext } from '@/lib/router-context';
import { type AppRouter } from './router';

export interface AppServices {
  api: ApiClient;
  auth: AuthController;
  hotkeys: HotkeyRegistry;
  router: AppRouter;
  context: RouterContext;
}

/** App-wide providers. The router renders once the session restore has settled. */
export function App({ services }: { services: AppServices }) {
  return (
    <QueryClientProvider client={services.context.queryClient}>
      <AuthProvider api={services.api} controller={services.auth}>
        <HotkeysProvider registry={services.hotkeys}>
          <TooltipProvider delayDuration={300}>
            <SessionGate router={services.router} context={services.context} />
            <Toaster position="bottom-right" closeButton />
          </TooltipProvider>
        </HotkeysProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function SessionGate({ router, context }: { router: AppRouter; context: RouterContext }) {
  const { status, controller } = useAuth();

  // Route guards read the session; re-run them whenever it changes (login, logout, expiry).
  useEffect(
    () =>
      controller.subscribe(() => {
        void router.invalidate();
      }),
    [controller, router],
  );

  if (status === 'restoring') {
    return (
      <div role="status" className="flex min-h-svh items-center justify-center gap-2 text-sm">
        <Loader2Icon aria-hidden className="size-4 animate-spin text-primary" />
        <span className="text-muted-foreground">Opening Ekaro…</span>
      </div>
    );
  }
  if (status === 'unreachable') {
    return (
      <div role="alert" className="flex min-h-svh flex-col items-center justify-center gap-3 px-4">
        <WifiOffIcon aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Could not reach Ekaro</p>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Check your internet connection. Your work is safe on the server.
        </p>
        <Button variant="outline" size="sm" onClick={() => void controller.restore()}>
          Try again
        </Button>
      </div>
    );
  }
  return <RouterProvider router={router} context={context} />;
}
