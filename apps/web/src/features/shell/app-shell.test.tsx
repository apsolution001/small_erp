import { PERMISSIONS } from '@ekaro/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { meResponse, OTHER_TENANT_ID, problem, TENANT_ID, tokenResponse } from '@/test/fixtures';
import { json, mockFetch, problemResponse } from '@/test/mock-fetch';
import { renderApp } from '@/test/render-app';

/** Every `masters.*:view` permission: what the Viewer role holds. */
const VIEWER = PERMISSIONS.filter((p) => p.startsWith('masters.') && p.endsWith(':view'));

function signedIn(permissions = meResponse().permissions) {
  return mockFetch()
    .on('POST /auth/refresh', () => json(200, tokenResponse()))
    .on('GET /auth/me', () => json(200, meResponse(permissions)));
}

describe('app shell', () => {
  it('shows the company, the financial year and the navigation the role may use', async () => {
    await renderApp(signedIn(VIEWER), '/');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Company: AAPFU0939F Traders/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^FY \d{4}-\d{2}$/)).toBeInTheDocument();
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(within(nav).getByText('Parties')).toBeInTheDocument();
    // Settings need access.* permissions that a Viewer lacks.
    expect(within(nav).queryByText('Users')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Settings')).not.toBeInTheDocument();
  });

  it('switches company: new session, emptied cache, then the new company is shown', async () => {
    const server = signedIn();
    sessionStorage.setItem(
      'ekaro.tenant-choices',
      JSON.stringify([
        { tenantId: TENANT_ID, name: 'AAPFU0939F Traders', slug: 'a', roleName: 'Owner' },
        { tenantId: OTHER_TENANT_ID, name: 'Shah Industries', slug: 'shah', roleName: 'Viewer' },
      ]),
    );
    const { user, queryClient } = await renderApp(server, '/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    queryClient.setQueryData(['masters', 'parties', 'list'], ['a party of the old company']);

    const switched = tokenResponse('shah-token', OTHER_TENANT_ID);
    switched.tenant.name = 'Shah Industries';
    const shahMe = { ...meResponse(VIEWER, OTHER_TENANT_ID) };
    shahMe.tenant = switched.tenant;
    server
      .on('POST /auth/switch-tenant', () => json(200, switched))
      .on('GET /auth/me', () => json(200, shahMe));

    await user.click(screen.getByRole('button', { name: /^Company:/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Shah Industries/ }));

    expect(
      await screen.findByRole('button', { name: /^Company: Shah Industries/ }),
    ).toBeInTheDocument();
    const [call] = server.callsTo('POST /auth/switch-tenant');
    expect(call?.body).toEqual({ tenantId: OTHER_TENANT_ID });
    expect(call?.headers.get('Authorization')).toBe('Bearer access-1');
    expect(server.callsTo('GET /auth/me').at(-1)?.headers.get('Authorization')).toBe(
      'Bearer shah-token',
    );
    expect(queryClient.getQueryData(['masters', 'parties', 'list'])).toBeUndefined();
    expect(await screen.findByText('Switched to Shah Industries')).toBeInTheDocument();
  });

  it('ends the session when switch-tenant finds no live session (401), without an error toast', async () => {
    const server = signedIn();
    sessionStorage.setItem(
      'ekaro.tenant-choices',
      JSON.stringify([
        { tenantId: TENANT_ID, name: 'AAPFU0939F Traders', slug: 'a', roleName: 'Owner' },
        { tenantId: OTHER_TENANT_ID, name: 'Shah Industries', slug: 'shah', roleName: 'Viewer' },
      ]),
    );
    const { user, router } = await renderApp(server, '/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    // The API cleared the cookie with its 401, so the silent refresh fails as well.
    server
      .on('POST /auth/switch-tenant', () => problemResponse(problem(401, 'REFRESH_REUSED')))
      .on('POST /auth/refresh', () => problemResponse(problem(401, 'UNAUTHENTICATED')));

    await user.click(screen.getByRole('button', { name: /^Company:/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Shah Industries/ }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Your session has ended/)).toBeInTheDocument();
    expect(server.callsTo('POST /auth/switch-tenant')).toHaveLength(1);
    expect(server.callsTo('POST /auth/switch-tenant')[0]?.credentials).toBe('include');
    expect(router.state.location.pathname).toBe('/login');
  });

  it('keeps the session when switching to a company the user is not in (403)', async () => {
    const server = signedIn();
    sessionStorage.setItem(
      'ekaro.tenant-choices',
      JSON.stringify([
        { tenantId: TENANT_ID, name: 'AAPFU0939F Traders', slug: 'a', roleName: 'Owner' },
        { tenantId: OTHER_TENANT_ID, name: 'Shah Industries', slug: 'shah', roleName: 'Viewer' },
      ]),
    );
    const { user, auth } = await renderApp(server, '/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    server.on('POST /auth/switch-tenant', () =>
      problemResponse(
        problem(403, 'FORBIDDEN', { detail: 'You do not have access to this company.' }),
      ),
    );

    await user.click(screen.getByRole('button', { name: /^Company:/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Shah Industries/ }));

    expect(await screen.findByText('You do not have access to this company.')).toBeInTheDocument();
    expect(auth.getState().status).toBe('authenticated');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(server.callsTo('POST /auth/refresh')).toHaveLength(1); // only the start-up restore
  });

  it('opens the command palette with Ctrl+K and navigates from it', async () => {
    const { user } = await renderApp(signedIn(), '/');
    await screen.findByRole('heading', { name: 'Dashboard' });

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(palette).getByRole('combobox'), 'keyboard');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    });
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('lists the registered shortcuts on ?', async () => {
    const { user } = await renderApp(signedIn(), '/');
    await screen.findByRole('heading', { name: 'Dashboard' });

    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(help).getByText('Open the command palette')).toBeInTheDocument();
    expect(within(help).getByText('Show keyboard shortcuts')).toBeInTheDocument();
    expect(within(help).getByText('Collapse or expand the sidebar')).toBeInTheDocument();
  });
});
