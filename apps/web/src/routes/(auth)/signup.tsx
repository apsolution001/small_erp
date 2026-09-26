import { createFileRoute } from '@tanstack/react-router';
import { SignupPage } from '@/features/auth/components/signup-page';
import { redirectIfSignedIn } from '@/features/auth/guards';

export const Route = createFileRoute('/(auth)/signup')({
  beforeLoad: ({ context }) => {
    redirectIfSignedIn({ context, redirectTo: undefined });
  },
  component: SignupPage,
});
