import { type Login, loginSchema, type TenantSelectionResponse } from '@ekaro/contracts';
import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';
import { Form, FormField } from '@/components/form-field';
import { FormAlert } from '@/components/form-alert';
import { PasswordInput } from '@/components/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, formResolver } from '@/lib/forms';

type LoginInput = z.input<typeof loginSchema>;

export interface LoginFormProps {
  /** The user belongs to several companies: show the picker. */
  onSelection: (selection: TenantSelectionResponse) => void;
  defaultEmail?: string;
}

/** Email + password. A single-company user is signed in straight away. */
export function LoginForm({ onSelection, defaultEmail = '' }: LoginFormProps) {
  const { controller } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput, unknown, Login>({
    resolver: formResolver(loginSchema),
    defaultValues: { email: defaultEmail, password: '' },
  });

  const submit = async (values: Login) => {
    setFormError(null);
    try {
      const result = await controller.login(values);
      if (result.kind === 'selection') onSelection(result.selection);
    } catch (error) {
      setFormError(applyServerErrors(form.setError, error, ['email', 'password']));
    }
  };

  return (
    <Form form={form} onSubmit={submit} className="grid gap-4" aria-label="Sign in">
      <FormAlert message={formError} />
      <FormField<LoginInput, 'email'>
        name="email"
        label="Email"
        render={({ field, control }) => (
          <Input {...field} {...control} type="email" autoComplete="username" autoFocus />
        )}
      />
      <FormField<LoginInput, 'password'>
        name="password"
        label="Password"
        render={({ field, control }) => (
          <PasswordInput {...field} {...control} autoComplete="current-password" />
        )}
      />
      <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
        {form.formState.isSubmitting ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
        Sign in
      </Button>
    </Form>
  );
}
