import { titled } from '@/lib/i18n-server';

// Страница клиентская, поэтому заголовок вкладки задаём серверным
// слоем: иначе во всех вкладках висит одно «BitrixFlow».
export const generateMetadata = () => titled('Поиск');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
