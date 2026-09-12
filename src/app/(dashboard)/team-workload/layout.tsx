import type { Metadata } from 'next';

// Страница клиентская, поэтому заголовок вкладки задаём серверным
// слоем: иначе во всех вкладках висит одно «BitrixFlow».
export const metadata: Metadata = { title: 'Нагрузка команды' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
