import { gstinLookupResponseSchema } from '@ekaro/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/auth';
import { checkGstin } from '@/lib/gstin';

export const platformKeys = {
  all: ['platform'] as const,
  gstin: (gstin: string) => [...platformKeys.all, 'gstin', gstin] as const,
};

/**
 * `GET /platform/gstin/:gstin` for signup auto-fill, once the GSTIN passes its checksum. The
 * endpoint is public and limited to 10 lookups a minute per IP, so a result is kept for the
 * session and a failure is not retried.
 */
export function useGstinLookup(gstin: string) {
  const api = useApi();
  return useQuery({
    queryKey: platformKeys.gstin(gstin),
    queryFn: ({ signal }) =>
      api.get(`/platform/gstin/${encodeURIComponent(gstin)}`, gstinLookupResponseSchema, {
        auth: false,
        signal,
      }),
    enabled: checkGstin(gstin).status === 'valid',
    staleTime: Infinity,
    retry: false,
  });
}
