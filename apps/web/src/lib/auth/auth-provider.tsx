import { type ReactNode, useMemo } from 'react';
import { type ApiClient } from '../api-client';
import { AuthContext } from './auth-context';
import { type AuthController } from './auth-controller';

export function AuthProvider({
  api,
  controller,
  children,
}: {
  api: ApiClient;
  controller: AuthController;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ api, controller }), [api, controller]);
  return <AuthContext value={value}>{children}</AuthContext>;
}
