import Dashboards from '@/components/Dashboards';
import { titled } from '@/lib/i18n-server';

export async function generateMetadata() {
  return titled('Дашборды');
}

export default function DashboardsPage() {
  return <Dashboards />;
}
