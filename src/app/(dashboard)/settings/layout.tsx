import { titled } from '@/lib/i18n-server';

export const generateMetadata = () => titled('Настройки');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
