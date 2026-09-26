import { type TenantSelectionResponse } from '@ekaro/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { LoginForm } from '../forms/login-form';
import { AuthLayout } from './auth-layout';
import { TenantPicker } from './tenant-picker';

/**
 * Sign in, then (for a user in several companies) pick one. When the session starts, the
 * route guard sends the user on to where they were going.
 */
export function LoginPage() {
  const { endReason } = useAuth();
  const [selection, setSelection] = useState<TenantSelectionResponse | null>(null);
  const [notice, setNotice] = useState(
    endReason === 'expired' ? 'Your session has ended. Sign in again to continue.' : '',
  );

  if (selection !== null) {
    return (
      <AuthLayout
        title="Choose a company"
        description="Your account has access to these companies."
      >
        <TenantPicker
          selection={selection}
          onRestart={(message) => {
            setNotice(message);
            setSelection(null);
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to your company."
      footer={
        <>
          New to Ekaro?{' '}
          <Link
            to="/signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Start your free trial
          </Link>
        </>
      }
    >
      <div className="grid gap-4">
        {notice === '' ? null : (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <LoginForm onSelection={setSelection} />
      </div>
    </AuthLayout>
  );
}
