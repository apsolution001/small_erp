import { type Signup, signupSchema } from '@ekaro/contracts';
import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { type z } from 'zod';
import { Form, FormField } from '@/components/form-field';
import { FormAlert } from '@/components/form-alert';
import { GstinInput } from '@/components/gstin-input';
import { MobileInput } from '@/components/mobile-input';
import { PasswordInput } from '@/components/password-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, formResolver } from '@/lib/forms';
import { useGstinLookup } from '../api';
import { GstinLookupCard } from '../components/gstin-lookup-card';

type SignupInput = z.input<typeof signupSchema>;

const FIELDS = ['gstin', 'fullName', 'email', 'mobile', 'password', 'acceptTerms'] as const;

/**
 * Signup (MS-01, BRD §13.1): the GSTIN first, so the company details come from the GST portal;
 * then the owner's name, email, mobile and password. Success signs the owner in.
 */
export function SignupForm() {
  const { controller } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SignupInput, unknown, Signup>({
    resolver: formResolver(signupSchema),
    defaultValues: { gstin: '', fullName: '', email: '', mobile: '', password: '' },
  });
  const gstin = useWatch({ control: form.control, name: 'gstin' });
  const lookup = useGstinLookup(gstin);
  const inactive = lookup.data !== undefined && lookup.data.status !== 'Active';

  const submit = async (values: Signup) => {
    setFormError(null);
    try {
      await controller.signup(values);
    } catch (error) {
      setFormError(applyServerErrors(form.setError, error, FIELDS));
    }
  };

  return (
    <Form form={form} onSubmit={submit} className="grid gap-4" aria-label="Create your account">
      <FormAlert message={formError} />
      <FormField<SignupInput, 'gstin'>
        name="gstin"
        label="Company GSTIN"
        render={({ field, control }) => (
          <GstinInput
            {...control}
            ref={field.ref}
            name={field.name}
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            autoFocus
          />
        )}
      />
      <GstinLookupCard data={lookup.data} isFetching={lookup.isFetching} error={lookup.error} />
      <FormField<SignupInput, 'fullName'>
        name="fullName"
        label="Your full name"
        render={({ field, control }) => <Input {...field} {...control} autoComplete="name" />}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField<SignupInput, 'email'>
          name="email"
          label="Work email"
          render={({ field, control }) => (
            <Input {...field} {...control} type="email" autoComplete="email" />
          )}
        />
        <FormField<SignupInput, 'mobile'>
          name="mobile"
          label="Mobile"
          render={({ field, control }) => (
            <MobileInput
              {...control}
              ref={field.ref}
              name={field.name}
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
      </div>
      <FormField<SignupInput, 'password'>
        name="password"
        label="Password"
        description="At least 10 characters. Avoid common passwords."
        render={({ field, control }) => (
          <PasswordInput {...field} {...control} autoComplete="new-password" />
        )}
      />
      <FormField<SignupInput, 'acceptTerms'>
        name="acceptTerms"
        layout="inline"
        label="I accept the Ekaro terms of service and privacy policy"
        render={({ field, control }) => (
          <Checkbox
            {...control}
            ref={field.ref}
            name={field.name}
            checked={field.value}
            onCheckedChange={(checked) => {
              field.onChange(checked === true);
            }}
            onBlur={field.onBlur}
            className="mt-0.5"
          />
        )}
      />
      <Button type="submit" disabled={form.formState.isSubmitting || inactive} className="w-full">
        {form.formState.isSubmitting ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
        Create account
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your 14-day trial includes every Growth feature. No card needed.
      </p>
    </Form>
  );
}
