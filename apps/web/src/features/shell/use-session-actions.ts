import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { errorMessage, isApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';

/**
 * Switch company: a new session for the other membership, then an empty cache (spec 01 §3.2).
 * The user lands on the dashboard, because the page they were on belonged to the old company.
 * Switching needs the refresh cookie too: a 401 means the session is over (the client's refresh
 * then fails and the guard shows login, which says why), while a 403 leaves the session as is.
 */
export function useSwitchTenant() {
  const { controller, tenants } = useAuth();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (tenantId: string) => controller.switchTenant(tenantId),
    onSuccess: async (_data, tenantId) => {
      const name = tenants.find((t) => t.tenantId === tenantId)?.name ?? 'the company';
      toast.success(`Switched to ${name}`);
      await navigate({ to: '/' });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 401) return;
      toast.error(errorMessage(error));
    },
  });
}

/** Log out: the API ends the session (cookie family) and the guard sends the user to login. */
export function useLogout() {
  const { controller } = useAuth();
  return useMutation({ mutationFn: () => controller.logout() });
}
