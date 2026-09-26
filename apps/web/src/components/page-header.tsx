import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Page actions, right-aligned (the primary action last). */
  actions?: ReactNode;
  /** Breadcrumbs or a back link above the title. */
  eyebrow?: ReactNode;
  className?: string;
}

/** The title row of every page: one `h1`, a short description and the page actions. */
export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-3 pb-4', className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow === undefined ? null : (
          <div className="text-xs text-muted-foreground">{eyebrow}</div>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
