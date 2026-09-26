import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { type RouterContext } from '@/lib/router-context';

/**
 * Where to go after login. Only a path on this app (`/…`, never `//host`), so a crafted link
 * cannot send the user to another site (open redirect).
 */
const internalPath = z.string().regex(/^\/(?![/\\])/);

export const loginSearchSchema = z.object({
  redirect: internalPath.optional().catch(undefined),
});

/** `_app` guard: no session → login, remembering the page unless the user logged out. */
export function requireSession({
  context,
  location,
}: {
  context: RouterContext;
  location: ParsedLocation;
}): void {
  const state = context.auth.getState();
  if (state.status === 'authenticated') return;
  throw redirect({
    to: '/login',
    search: state.endReason === 'logged_out' ? {} : { redirect: location.href },
    replace: true,
  });
}

/** Login and signup guard: a signed-in user goes on to the app. */
export function redirectIfSignedIn({
  context,
  redirectTo,
}: {
  context: RouterContext;
  redirectTo: string | undefined;
}): void {
  if (context.auth.getState().status !== 'authenticated') return;
  throw redirect({ href: redirectTo ?? '/', replace: true });
}
