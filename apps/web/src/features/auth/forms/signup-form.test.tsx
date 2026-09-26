import { type GstinLookupResponse } from '@ekaro/contracts';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { meResponse, problem, tokenResponse } from '@/test/fixtures';
import { json, mockFetch, problemResponse } from '@/test/mock-fetch';
import { renderApp } from '@/test/render-app';

const GSTIN = '27AAPFU0939F1ZV';

function lookup(status: GstinLookupResponse['status'] = 'Active'): GstinLookupResponse {
  return {
    gstin: GSTIN,
    legalName: 'AAPFU0939F and Associates',
    tradeName: 'AAPFU0939F Traders',
    pan: 'AAPFU0939F',
    stateCode: '27',
    status,
    address: {
      line1: 'Unit 0939, Industrial Estate',
      line2: null,
      city: 'Maharashtra',
      pincode: '409390',
      stateCode: '27',
    },
  };
}

async function openSignup(server: ReturnType<typeof mockFetch>) {
  server.on('POST /auth/refresh', () => problemResponse(problem(401, 'UNAUTHENTICATED')));
  const app = await renderApp(server, '/signup');
  await screen.findByRole('heading', { name: 'Start your free trial' });
  return app;
}

async function fillOwner(user: Awaited<ReturnType<typeof openSignup>>['user']) {
  await user.type(screen.getByLabelText('Your full name'), 'Asha Mehta');
  await user.type(screen.getByLabelText('Work email'), 'Asha@Example.com');
  await user.type(screen.getByLabelText('Mobile'), '98765 43210');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByLabelText(/I accept the Ekaro terms/));
}

describe('signup', () => {
  it('auto-fills the company from the GSTIN, then creates the account and signs in', async () => {
    const server = mockFetch()
      .on(`GET /platform/gstin/${GSTIN}`, () => json(200, lookup()))
      .on('POST /auth/signup', () => json(201, tokenResponse('new-owner')))
      .on('GET /auth/me', () => json(200, meResponse()));
    const { user } = await openSignup(server);

    await user.type(screen.getByLabelText('Company GSTIN'), GSTIN.toLowerCase());
    const registration = await screen.findByRole('region', { name: 'GST registration' });
    expect(registration).toHaveTextContent('AAPFU0939F and Associates');
    expect(registration).toHaveTextContent('Maharashtra');
    expect(registration).toHaveTextContent('Active');
    expect(server.callsTo(`GET /platform/gstin/${GSTIN}`)[0]?.headers.has('Authorization')).toBe(
      false,
    );

    await fillOwner(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(server.callsTo('POST /auth/signup')[0]?.body).toEqual({
      gstin: GSTIN,
      fullName: 'Asha Mehta',
      email: 'asha@example.com',
      mobile: '+919876543210',
      password: 'correct horse battery',
      acceptTerms: true,
    });
  });

  it('blocks signup for a GSTIN the portal reports as cancelled', async () => {
    const server = mockFetch().on(`GET /platform/gstin/${GSTIN}`, () =>
      json(200, lookup('Cancelled')),
    );
    const { user } = await openSignup(server);

    await user.type(screen.getByLabelText('Company GSTIN'), GSTIN);

    expect(
      await screen.findByText(/This GSTIN is cancelled on the GST portal/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('keeps signup open when the GST portal lookup is unavailable (503)', async () => {
    const server = mockFetch().on(`GET /platform/gstin/${GSTIN}`, () =>
      problemResponse(problem(503, 'SERVICE_UNAVAILABLE', { detail: 'GSP down.' })),
    );
    const { user } = await openSignup(server);

    await user.type(screen.getByLabelText('Company GSTIN'), GSTIN);

    expect(
      await screen.findByText(/GST portal lookup is unavailable right now/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('puts server validation errors on their fields', async () => {
    const server = mockFetch()
      .on(`GET /platform/gstin/${GSTIN}`, () => json(200, lookup()))
      .on('POST /auth/signup', () =>
        problemResponse(
          problem(422, 'VALIDATION_FAILED', {
            detail: 'Some fields are invalid.',
            errors: [
              { path: 'password', message: 'This password is too common.', code: 'too_common' },
            ],
          }),
        ),
      );
    const { user } = await openSignup(server);

    await user.type(screen.getByLabelText('Company GSTIN'), GSTIN);
    await fillOwner(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('This password is too common.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Some fields are invalid.')).not.toBeInTheDocument();
  });
});
