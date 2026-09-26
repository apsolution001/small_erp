import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api-error';

const MAX_RETRIES = 2;

/**
 * Retries only what can succeed on a second try: network failures and 5xx / 429. A 4xx is an
 * answer (not found, forbidden, invalid) and retrying it only delays the error state.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (!isApiError(error)) return false;
  if (error.code === 'INVALID_RESPONSE') return false;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Masters change rarely; lists refetch when a mutation invalidates them.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        // An accountant switching windows mid-entry should not see lists jump.
        refetchOnWindowFocus: false,
      },
      mutations: {
        // A retried POST could create a second document.
        retry: false,
      },
    },
  });
}
