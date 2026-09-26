import { CircleAlertIcon, InboxIcon, type LucideIcon, RotateCwIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

interface StateFrameProps {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone: 'muted' | 'destructive';
  role?: 'alert' | 'status';
  className?: string | undefined;
}

function StateFrame({
  icon: Icon,
  title,
  description,
  action,
  tone,
  role,
  className,
}: StateFrameProps) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <div
        className={cn(
          'mb-1 flex size-10 items-center justify-center rounded-full',
          tone === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-muted',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        <Icon aria-hidden className="size-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Usually the primary "New …" button, gated with `useCan`. */
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

/** Nothing to show yet (frontend standard: no blank screens). */
export function EmptyState({ icon = InboxIcon, ...props }: EmptyStateProps) {
  return <StateFrame {...props} icon={icon} tone="muted" role="status" />;
}

export interface ErrorStateProps {
  error: unknown;
  title?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

/** A failed load, with the server's message and a retry. Shows the request id for support. */
export function ErrorState({
  error,
  title = 'Could not load this',
  onRetry,
  className,
}: ErrorStateProps) {
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <StateFrame
      icon={CircleAlertIcon}
      tone="destructive"
      role="alert"
      title={title}
      className={className}
      description={
        <>
          {errorMessage(error)}
          {requestId === undefined ? null : (
            <span className="mt-1 block text-xs">Reference: {requestId}</span>
          )}
        </>
      }
      action={
        onRetry === undefined ? undefined : (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCwIcon aria-hidden />
            Try again
          </Button>
        )
      }
    />
  );
}
