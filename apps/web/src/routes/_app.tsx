import { createFileRoute } from '@tanstack/react-router';
import { requireSession } from '@/features/auth/guards';
import { AppShell } from '@/features/shell/app-shell';

/** Every signed-in screen lives under this pathless layout. */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    requireSession({ context, location });
  },
  component: AppShell,
});
