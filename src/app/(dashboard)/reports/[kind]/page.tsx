import { notFound } from 'next/navigation';
import PmReport from '@/components/PmReport';
import { titled } from '@/lib/i18n-server';
import { REPORT_KINDS, type ReportKind } from '@/lib/pm-reports-data';

// Заголовки вкладок по-русски: titled() переводит их сам, как у остальных страниц.
const TITLES: Record<ReportKind, string> = {
  'plan-fact': 'План и факт',
  deadlines: 'Сроки',
  throughput: 'Поток задач',
  defects: 'Брак',
  timesheets: 'Списание часов',
  stale: 'Зависшие задачи',
  client: 'Отчёт клиенту',
};

type Props = { params: Promise<{ kind: string }> };

export async function generateMetadata({ params }: Props) {
  const { kind } = await params;
  return titled(TITLES[kind as ReportKind] || 'Отчёт');
}

export default async function ReportPage({ params }: Props) {
  const { kind } = await params;
  if (!REPORT_KINDS.includes(kind as ReportKind)) notFound();
  return <PmReport kind={kind as ReportKind} />;
}
