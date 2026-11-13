import { cookies } from 'next/headers';
import DashboardShell from '@/components/DashboardShell';
import { sessionCookie } from '@/lib/session';
import { getSessionUser } from '@/lib/session-store';

// Роль известна серверу уже при рендере: пункт «Учётные записи» рисуется сразу, а не
// появляется после отдельного запроса и не сдвигает подвал сайдбара.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser((await cookies()).get(sessionCookie.name)?.value).catch(
    () => null,
  );
  return <DashboardShell isAdmin={user?.role === 'admin'}>{children}</DashboardShell>;
}
