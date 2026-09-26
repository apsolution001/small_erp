import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '@/features/auth/components/login-page';
import { loginSearchSchema, redirectIfSignedIn } from '@/features/auth/guards';

export const Route = createFileRoute('/(auth)/login')({
  validateSearch: loginSearchSchema,
  beforeLoad: ({ context, search }) => {
    redirectIfSignedIn({ context, redirectTo: search.redirect });
  },
  component: LoginPage,
});
