import { type MeResponse, type Permission } from '@ekaro/contracts';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useSyncExternalStore } from 'react';
import { type ApiClient } from '../api-client';
import { meQueryOptions } from './auth-api';
import { type AuthController, type AuthState } from './auth-controller';

export interface AuthServices {
  api: ApiClient;
  controller: AuthController;
}

export const AuthContext = createContext<AuthServices | null>(null);

function useAuthServices(): AuthServices {
  const services = useContext(AuthContext);
  if (services === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return services;
}

/** The typed API client, for feature `api.ts` hooks. */
export function useApi(): ApiClient {
  return useAuthServices().api;
}

export interface UseAuth extends AuthState {
  /** The signed-in session (`/auth/me`); undefined unless authenticated. */
  me: MeResponse | undefined;
  controller: AuthController;
}

export function useAuth(): UseAuth {
  const { api, controller } = useAuthServices();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { data: me } = useQuery({
    ...meQueryOptions(api),
    enabled: state.status === 'authenticated',
  });
  return { ...state, me: state.status === 'authenticated' ? me : undefined, controller };
}

/**
 * True when the signed-in role has the permission (`/auth/me` effective permissions). Only for
 * hiding or disabling UI: the API enforces every permission itself.
 */
export function useCan(permission: Permission): boolean {
  return usePermissionCheck()(permission);
}

/** `can(permission)` for checking many permissions at once (navigation, menus). */
export function usePermissionCheck(): (permission: Permission) => boolean {
  const { me } = useAuth();
  const granted = me?.permissions;
  return (permission) => granted?.includes(permission) ?? false;
}
