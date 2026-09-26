import { LineChartIcon } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { OnboardingChecklist } from './onboarding-checklist';

/** The owner dashboard (BRD §7.8). Live figures arrive with the transaction modules. */
export function DashboardPage() {
  const { me } = useAuth();
  const firstName = me?.user.fullName.split(/\s+/)[0] ?? '';

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Dashboard"
        description={`Welcome${firstName === '' ? '' : `, ${firstName}`}. Here is ${me?.tenant.name ?? 'your company'} at a glance.`}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <OnboardingChecklist />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Business at a glance</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={LineChartIcon}
              title="No transactions yet"
              description="Stock value, receivables, payables, cash and production status appear here as you start recording purchases and sales."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
