import {
  type Login,
  loginResponseSchema,
  meResponseSchema,
  type SelectTenant,
  type Signup,
  tokenResponseSchema,
} from '@ekaro/contracts';
import { queryOptions } from '@tanstack/react-query';
import { type ApiClient } from '../api-client';

/** Session endpoints of `/api/v1/auth` (spec 01 §3.1–3.2, T-104 follow-ups). */
export const authApi = {
  signup: (api: ApiClient, body: Signup) =>
    api.post('/auth/signup', tokenResponseSchema, { body, auth: false }),
  login: (api: ApiClient, body: Login) =>
    api.post('/auth/login', loginResponseSchema, { body, auth: false }),
  selectTenant: (api: ApiClient, body: SelectTenant) =>
    api.post('/auth/select-tenant', tokenResponseSchema, { body, auth: false }),
  switchTenant: (api: ApiClient, tenantId: string) =>
    api.post('/auth/switch-tenant', tokenResponseSchema, { body: { tenantId } }),
  /** Always 204; it ends whatever session the cookie belongs to. */
  logout: (api: ApiClient) => api.send('POST', '/auth/logout', { auth: false }),
  me: (api: ApiClient) => api.get('/auth/me', meResponseSchema),
};

export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
};

/** The signed-in user, company, role and effective permissions. */
export function meQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: authKeys.me(),
    queryFn: () => authApi.me(api),
    staleTime: 5 * 60 * 1000,
  });
}
