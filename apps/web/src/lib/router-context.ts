import { type QueryClient } from '@tanstack/react-query';
import { type AuthController } from './auth/auth-controller';

/** What every route's `beforeLoad` / `loader` receives. */
export interface RouterContext {
  auth: AuthController;
  queryClient: QueryClient;
}
