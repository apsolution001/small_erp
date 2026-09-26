import { type ComponentProps, type ReactNode, useId } from 'react';
import {
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  type SubmitHandler,
  useController,
  type UseFormReturn,
} from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { focusNextFieldOnEnter } from '@/lib/hotkeys';
import { cn } from '@/lib/utils';

export type FormProps<TValues extends FieldValues, TOutput> = Omit<
  ComponentProps<'form'>,
  'onSubmit'
> & {
  form: UseFormReturn<TValues, unknown, TOutput>;
  onSubmit: SubmitHandler<TOutput>;
};

/**
 * A react-hook-form `<form>`: provides the form context, validates with the resolver before
 * `onSubmit`, and moves to the next field on Enter (keyboard-first, BRD §5).
 */
export function Form<TValues extends FieldValues, TOutput>({
  form,
  onSubmit,
  onKeyDown,
  children,
  ...props
}: FormProps<TValues, TOutput>) {
  return (
    <FormProvider {...form}>
      <form
        noValidate
        {...props}
        onKeyDown={(event) => {
          focusNextFieldOnEnter(event);
          onKeyDown?.(event);
        }}
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      >
        {children}
      </form>
    </FormProvider>
  );
}

/** Accessibility wiring for the control inside a FormField. */
export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

export interface FormFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  name: TName;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  /** `inline` puts the control before its label on one row (checkboxes, switches). */
  layout?: 'stacked' | 'inline';
  render: (args: {
    field: ControllerRenderProps<TValues, TName>;
    fieldState: ControllerFieldState;
    control: FieldControlProps;
  }) => ReactNode;
}

/**
 * Label + control + message for one form field. Messages come from the zod resolver or from
 * the server (`applyServerErrors`), and are linked to the control for screen readers.
 */
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  name,
  label,
  description,
  className,
  layout = 'stacked',
  render,
}: FormFieldProps<TValues, TName>) {
  const { field, fieldState } = useController<TValues, TName>({ name });
  const id = useId();
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const messageId = fieldState.error?.message === undefined ? undefined : `${id}-message`;
  const describedBy = [descriptionId, messageId].filter(Boolean).join(' ') || undefined;

  const labelNode = (
    <Label
      htmlFor={id}
      className={cn(fieldState.invalid && 'text-destructive', layout === 'inline' && 'font-normal')}
    >
      {label}
    </Label>
  );
  const controlNode = render({
    field,
    fieldState,
    control: { id, 'aria-invalid': fieldState.invalid, 'aria-describedby': describedBy },
  });

  return (
    <div className={cn('grid gap-1.5', className)} data-invalid={fieldState.invalid || undefined}>
      {layout === 'inline' ? (
        <div className="flex items-start gap-2">
          {controlNode}
          {labelNode}
        </div>
      ) : (
        <>
          {labelNode}
          {controlNode}
        </>
      )}
      {description === undefined ? null : (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {messageId === undefined ? null : (
        <p id={messageId} role="alert" className="text-xs font-medium text-destructive">
          {fieldState.error?.message}
        </p>
      )}
    </div>
  );
}
