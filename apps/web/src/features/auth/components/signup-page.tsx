import { Link } from '@tanstack/react-router';
import { SignupForm } from '../forms/signup-form';
import { AuthLayout } from './auth-layout';

export function SignupPage() {
  return (
    <AuthLayout
      wide
      title="Start your free trial"
      description="Enter your GSTIN and we fill in your company from the GST portal."
      footer={
        <>
          Already on Ekaro?{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthLayout>
  );
}
