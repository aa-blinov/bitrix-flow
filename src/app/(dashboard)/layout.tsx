import { cookies } from 'next/headers';
import BitrixConnectGate from '@/components/BitrixConnectGate';
import DashboardShell from '@/components/DashboardShell';
import { getSessionPerson } from '@/lib/people';
import { sessionCookie } from '@/lib/session';
import { getSessionUser } from '@/lib/session-store';

// Роль известна серверу уже при рендере: пункт «Учётные записи» рисуется сразу, а не
// появляется после отдельного запроса и не сдвигает подвал сайдбара.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await cookies()).get(sessionCookie.name)?.value;
  const user = await getSessionUser(cookie).catch(() => null);
  // Вошли паролем, но Битрикс не подключён: без него данных нет, вместо экранов просьба
  // подключить. Сессии нет совсем: этим занимается proxy, он уводит на /login.
  if (user && !(await getSessionPerson(cookie).catch(() => null))) return <BitrixConnectGate />;
  return <DashboardShell isAdmin={user?.role === 'admin'}>{children}</DashboardShell>;
}
