import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { meResponse, OTHER_TENANT_ID, problem, TENANT_ID, tokenResponse } from '@/test/fixtures';
import { json, mockFetch, problemResponse } from '@/test/mock-fetch';
import { renderApp } from '@/test/render-app';

const noSession = () => problemResponse(problem(401, 'UNAUTHENTICATED'));

async function openLogin(server: ReturnType<typeof mockFetch>, path = '/login') {
  server.on('POST /auth/refresh', noSession);
  const app = await renderApp(server, path);
  await screen.findByRole('heading', { name: 'Sign in' });
  return app;
}

describe('login form', () => {
  it('refuses a password bcrypt would truncate (over 72 UTF-8 bytes) before calling the API', async () => {
    const server = mockFetch();
    const { user } = await openLogin(server);
    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), '₹'.repeat(25)); // 75 bytes
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Use at most 72 bytes')).toBeInTheDocument();
    expect(server.callsTo('POST /auth/login')).toHaveLength(0);
  });

  it('validates with the contracts schema before calling the API', async () => {
    const server = mockFetch();
    const { user } = await openLogin(server);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(server.callsTo('POST /auth/login')).toHaveLength(0);
  });

  it('moves to the next field on Enter, and submits the normalised payload from the last', async () => {
    const server = mockFetch()
      .on('POST /auth/login', () => json(200, tokenResponse('fresh')))
      .on('GET /auth/me', () => json(200, meResponse()));
    const { user, router } = await openLogin(server, '/login?redirect=%2F');

    await user.type(screen.getByLabelText('Email'), '  Owner@Example.COM {Enter}');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    await user.type(screen.getByLabelText('Password'), 'correct horse battery{Enter}');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(server.callsTo('POST /auth/login')).toHaveLength(1);
    const [login] = server.callsTo('POST /auth/login');
    expect(login?.body).toEqual({ email: 'owner@example.com', password: 'correct horse battery' });
    expect(login?.credentials).toBe('include');
    expect(login?.headers.has('Authorization')).toBe(false);
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows the server message for wrong credentials and stays on login', async () => {
    const server = mockFetch().on('POST /auth/login', () =>
      problemResponse(
        problem(401, 'INVALID_CREDENTIALS', { detail: 'The email or password is incorrect.' }),
      ),
    );
    const { user } = await openLogin(server);

    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('The email or password is incorrect.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('tenant picker', () => {
  const selection = {
    requiresTenantSelection: true,
    selectionToken: 'selection.jwt',
    tenants: [
      { tenantId: TENANT_ID, name: 'Mehta Traders', slug: 'mehta', roleName: 'Accountant' },
      { tenantId: OTHER_TENANT_ID, name: 'Shah Industries', slug: 'shah', roleName: 'Viewer' },
    ],
  };

  it('lets a user with several companies choose one, then opens it', async () => {
    const server = mockFetch()
      .on('POST /auth/login', () => json(200, selection))
      .on('POST /auth/select-tenant', () => json(200, tokenResponse('shah', OTHER_TENANT_ID)))
      .on('GET /auth/me', () => json(200, meResponse(undefined, OTHER_TENANT_ID)));
    const { user, auth } = await openLogin(server);

    await user.type(screen.getByLabelText('Email'), 'ca@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough password{Enter}');
    expect(await screen.findByRole('heading', { name: 'Choose a company' })).toBeInTheDocument();
    expect(server.callsTo('GET /auth/me')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Shah Industries/ }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(server.callsTo('POST /auth/select-tenant')[0]?.body).toEqual({
      selectionToken: 'selection.jwt',
      tenantId: OTHER_TENANT_ID,
    });
    // Both companies stay available to the switcher; the chosen one is current.
    expect(auth.getState().tenants.map((t) => t.tenantId)).toEqual([TENANT_ID, OTHER_TENANT_ID]);
  });

  it('never retries a single-use selection token: any failure goes back to login', async () => {
    const server = mockFetch()
      .on('POST /auth/login', () => json(200, selection))
      .on('POST /auth/select-tenant', () =>
        problemResponse(
          problem(403, 'FORBIDDEN', { detail: 'You do not have access to this company.' }),
        ),
      );
    const { user } = await openLogin(server);

    await user.type(screen.getByLabelText('Email'), 'ca@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough password{Enter}');
    await user.click(await screen.findByRole('button', { name: /Shah Industries/ }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'You do not have access to this company. Sign in again to choose a company.',
      ),
    ).toBeInTheDocument();
    expect(server.callsTo('POST /auth/select-tenant')).toHaveLength(1);
  });

  it('sends the user back to login when the 5-minute selection token has expired', async () => {
    const server = mockFetch()
      .on('POST /auth/login', () => json(200, selection))
      .on('POST /auth/select-tenant', () =>
        problemResponse(problem(401, 'TOKEN_EXPIRED', { detail: 'Expired.' })),
      );
    const { user } = await openLogin(server);

    await user.type(screen.getByLabelText('Email'), 'ca@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough password{Enter}');
    await user.click(await screen.findByRole('button', { name: /Mehta Traders/ }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/That took too long/)).toBeInTheDocument();
  });
});
