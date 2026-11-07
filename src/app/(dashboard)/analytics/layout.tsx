import { titled } from '@/lib/i18n-server';

// Страница клиентская, поэтому заголовок вкладки задаём серверным слоем.
export const generateMetadata = () => titled('Аналитика часов');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
