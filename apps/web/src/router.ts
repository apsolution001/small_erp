import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { type RouterContext } from './lib/router-context';
import { routeTree } from './routeTree.gen';

export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    ...(history ? { history } : {}),
    defaultPreload: 'intent',
    // Queries own freshness; the router must not cache loader results on top.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
