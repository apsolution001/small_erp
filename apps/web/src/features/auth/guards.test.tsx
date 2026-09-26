import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { meResponse, problem, tokenResponse } from '@/test/fixtures';
import { json, mockFetch, noContent, problemResponse } from '@/test/mock-fetch';
import { renderApp } from '@/test/render-app';

const noSession = () => problemResponse(problem(401, 'UNAUTHENTICATED'));

describe('auth guard', () => {
  it('sends a visitor without a session to login, remembering the page', async () => {
    const server = mockFetch().on('POST /auth/refresh', noSession);
    const { router } = await renderApp(server, '/');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/' });
  });

  it('restores the session from the refresh cookie on load and opens the page', async () => {
    const server = mockFetch()
      .on('POST /auth/refresh', () => json(200, tokenResponse('restored')))
      .on('GET /auth/me', () => json(200, meResponse()));
    const { router } = await renderApp(server, '/');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(server.callsTo('GET /auth/me')[0]?.headers.get('Authorization')).toBe('Bearer restored');
  });

  it('keeps a signed-in user away from login, honouring only internal redirects', async () => {
    const server = mockFetch()
      .on('POST /auth/refresh', () => json(200, tokenResponse()))
      .on('GET /auth/me', () => json(200, meResponse()));
    const { router } = await renderApp(server, '/login?redirect=%2F%2Fevil.example');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.href).toBe('/');
  });

  it('logs out to the login page without a redirect back', async () => {
    const server = mockFetch()
      .on('POST /auth/refresh', () => json(200, tokenResponse()))
      .on('GET /auth/me', () => json(200, meResponse()))
      .on('POST /auth/logout', () => noContent());
    const { router, user, api } = await renderApp(server, '/');

    await user.click(await screen.findByRole('button', { name: /^Account:/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(server.callsTo('POST /auth/logout')[0]?.credentials).toBe('include');
    expect(api.getAccessToken()).toBeNull();
  });

  it('signs the user out when the session cannot be refreshed any more', async () => {
    const server = mockFetch()
      .on('POST /auth/refresh', () => json(200, tokenResponse()))
      .on('GET /auth/me', () => json(200, meResponse()));
    const { router, auth, api } = await renderApp(server, '/');
    await screen.findByRole('heading', { name: 'Dashboard' });

    server.on('POST /auth/refresh', () => problemResponse(problem(401, 'REFRESH_REUSED')));
    await api.refreshSession().catch(() => undefined);

    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
    expect(auth.getState()).toMatchObject({ status: 'anonymous', endReason: 'expired' });
    expect(router.state.location.search).toEqual({ redirect: '/' });
  });
});
