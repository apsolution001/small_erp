import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/app';
import { ApiClient } from '@/lib/api-client';
import { AuthController } from '@/lib/auth/auth-controller';
import { HotkeyRegistry } from '@/lib/hotkeys';
import { createQueryClient } from '@/lib/query-client';
import { createAppRouter } from '@/router';
import { type mockFetch } from './mock-fetch';

/**
 * Renders the whole app (providers, router, guards) against a fetch double, at `path`, after
 * the start-up session restore has settled, as `main.tsx` does.
 */
export async function renderApp(server: ReturnType<typeof mockFetch>, path = '/') {
  const api = new ApiClient({ baseUrl: server.baseUrl, fetch: server.fetch, lock: undefined });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const auth = new AuthController(api, queryClient);
  const context = { auth, queryClient };
  const router = createAppRouter(context, createMemoryHistory({ initialEntries: [path] }));
  const restored = auth.restore();
  const user = userEvent.setup();
  const view = render(
    <App services={{ api, auth, hotkeys: new HotkeyRegistry(false), router, context }} />,
  );
  await restored;
  return { ...view, user, router, auth, api, queryClient };
}
