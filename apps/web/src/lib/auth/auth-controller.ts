import {
  type Login,
  type SelectTenant,
  type Signup,
  type TenantChoice,
  type TenantSelectionResponse,
  type TokenResponse,
} from '@ekaro/contracts';
import { type QueryClient } from '@tanstack/react-query';
import { type ApiClient } from '../api-client';
import { isApiError } from '../api-error';
import { authApi, authKeys, meQueryOptions } from './auth-api';
import { loadTenantChoices, saveTenantChoices, withCurrentTenant } from './tenant-choices';

/**
 * - `restoring`: the app just loaded and is trying the refresh cookie.
 * - `unreachable`: that attempt could not reach the API (offline); the session may still be good.
 */
export type AuthStatus = 'restoring' | 'unreachable' | 'authenticated' | 'anonymous';

/** Why the last session ended, so the login page can say so. */
export type SessionEndReason = 'expired' | 'logged_out';

export interface AuthState {
  readonly status: AuthStatus;
  readonly tenants: readonly TenantChoice[];
  readonly endReason?: SessionEndReason;
}

export type LoginResult =
  { kind: 'session' } | { kind: 'selection'; selection: TenantSelectionResponse };

/**
 * Owns the session lifecycle outside React (so the router guard and tests can use it too):
 * restore on load, login (with tenant selection), signup, switch-tenant and logout. The access
 * token stays in the ApiClient's memory; `/auth/me` lives in the query cache.
 */
export class AuthController {
  private state: AuthState = { status: 'restoring', tenants: [] };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly api: ApiClient,
    private readonly queryClient: QueryClient,
  ) {
    api.onSessionEvent((event) => {
      // A refresh refused mid-session (expired, reused, access revoked) signs the user out.
      if (event.type === 'expired' && this.state.status === 'authenticated') {
        this.end('expired');
      }
    });
  }

  getState = (): AuthState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** On app load: the refresh cookie (if any) becomes a session again. */
  async restore(): Promise<void> {
    this.set({ status: 'restoring', tenants: [] });
    try {
      const session = await this.api.refreshSession();
      await this.establish(session, loadTenantChoices());
    } catch (error) {
      this.api.setAccessToken(null);
      if (isApiError(error) && error.code === 'NETWORK_ERROR') {
        this.set({ status: 'unreachable', tenants: [] });
      } else {
        this.set({ status: 'anonymous', tenants: [] });
      }
    }
  }

  async login(input: Login): Promise<LoginResult> {
    const result = await authApi.login(this.api, input);
    if ('requiresTenantSelection' in result) {
      saveTenantChoices(result.tenants);
      return { kind: 'selection', selection: result };
    }
    await this.establish(result, []);
    return { kind: 'session' };
  }

  async selectTenant(input: SelectTenant): Promise<void> {
    await this.establish(await authApi.selectTenant(this.api, input), loadTenantChoices());
  }

  async signup(input: Signup): Promise<void> {
    await this.establish(await authApi.signup(this.api, input), []);
  }

  /**
   * Moves the session to another company. Every cached query belonged to the old company, so
   * the cache is emptied (not merely invalidated: old rows must never show under the new name).
   */
  async switchTenant(tenantId: string): Promise<void> {
    const session = await authApi.switchTenant(this.api, tenantId);
    this.api.setAccessToken(session.accessToken);
    this.queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== authKeys.all[0] });
    await this.queryClient.query({ ...meQueryOptions(this.api), staleTime: 0 });
    this.commit(session, this.state.tenants);
  }

  async logout(): Promise<void> {
    try {
      await authApi.logout(this.api);
    } catch (error) {
      // Offline or failing: the local session still ends; the cookie expires on its own.
      if (!isApiError(error)) throw error;
    }
    this.end('logged_out');
  }

  private async establish(session: TokenResponse, known: readonly TenantChoice[]): Promise<void> {
    this.api.setAccessToken(session.accessToken);
    this.queryClient.clear();
    try {
      await this.queryClient.query({ ...meQueryOptions(this.api), staleTime: 0 });
    } catch (error) {
      this.api.setAccessToken(null);
      throw error;
    }
    this.commit(session, known);
  }

  private commit(session: TokenResponse, known: readonly TenantChoice[]): void {
    const tenants = withCurrentTenant(known, session);
    saveTenantChoices(tenants);
    this.set({ status: 'authenticated', tenants });
  }

  private end(reason: SessionEndReason): void {
    this.api.setAccessToken(null);
    this.queryClient.clear();
    saveTenantChoices([]);
    this.set({ status: 'anonymous', tenants: [], endReason: reason });
  }

  private set(next: AuthState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
