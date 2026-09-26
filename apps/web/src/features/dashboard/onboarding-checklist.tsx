import { CheckCircle2Icon, CircleIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Step {
  id: string;
  title: string;
  detail: string;
  done: boolean;
}

/**
 * BRD §13.1 self-serve path. Only signup can be complete today; each step gets its real
 * status (and a link) as its module ships.
 */
const STEPS: readonly Step[] = [
  {
    id: 'signup',
    title: 'Sign up with your GSTIN',
    detail: 'Company details filled in from the GST portal.',
    done: true,
  },
  {
    id: 'template',
    title: 'Pick an industry template',
    detail: 'Loads units, item categories, ledgers and settings for your trade.',
    done: false,
  },
  {
    id: 'import',
    title: 'Import items and parties',
    detail: 'From the Excel template or from Tally.',
    done: false,
  },
  {
    id: 'opening',
    title: 'Enter opening stock and balances',
    detail: 'So stock and the trial balance match your old books.',
    done: false,
  },
  {
    id: 'team',
    title: 'Invite your team',
    detail: 'Give each person a role: accountant, store, sales and more.',
    done: false,
  },
  {
    id: 'invoice',
    title: 'Create your first invoice',
    detail: 'With the e-invoice and e-way bill in the same step.',
    done: false,
  },
];

export function OnboardingChecklist() {
  const done = STEPS.filter((s) => s.done).length;
  const percent = Math.round((done / STEPS.length) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Get set up</h2>
        </CardTitle>
        <CardDescription>
          {done} of {STEPS.length} steps done. Most companies go live in a day.
        </CardDescription>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {STEPS.map((step) => (
            <li key={step.id} className="flex items-start gap-3">
              {step.done ? (
                <CheckCircle2Icon aria-label="Done" className="mt-0.5 size-4 text-success" />
              ) : (
                <CircleIcon aria-label="To do" className="mt-0.5 size-4 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
              {step.done ? null : (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  Soon
                </Badge>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
