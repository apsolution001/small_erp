import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Link,
  Outlet,
} from '@tanstack/react-router';
import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { ShellUiProvider } from '@/features/shell/shell-ui-provider';
import { type RouterContext } from '@/lib/router-context';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

function RootLayout() {
  return (
    <ShellUiProvider>
      <Outlet />
    </ShellUiProvider>
  );
}

function NotFound() {
  return (
    <EmptyState
      className="min-h-[60svh]"
      title="Page not found"
      description="The link may be old, or the page may not exist yet."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/">Go to the dashboard</Link>
        </Button>
      }
    />
  );
}

function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <ErrorState
      className="min-h-[60svh]"
      title="This page could not be shown"
      error={error}
      onRetry={reset}
    />
  );
}
