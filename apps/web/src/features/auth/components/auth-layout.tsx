import { type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** The frame of the signed-out pages: brand, one card, and a footer link. */
export function AuthLayout({
  title,
  description,
  footer,
  children,
  wide = false,
}: {
  title: ReactNode;
  description: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-8">
      <div className={cn('w-full space-y-6', wide ? 'max-w-lg' : 'max-w-sm')}>
        <div className="text-center">
          <p className="text-2xl font-semibold tracking-tight text-primary">Ekaro</p>
          <p className="text-xs text-muted-foreground">Ek system. Poora business.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-lg">{title}</h1>
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {footer === undefined ? null : (
          <p className="text-center text-sm text-muted-foreground">{footer}</p>
        )}
      </div>
    </main>
  );
}
