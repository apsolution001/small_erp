import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** A form-level error (one that belongs to no single field). Renders nothing without one. */
export function FormAlert({ message }: { message: string | null | undefined }) {
  if (message === null || message === undefined || message === '') return null;
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
