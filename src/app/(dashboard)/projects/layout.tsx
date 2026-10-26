import { titled } from '@/lib/i18n-server';

export const generateMetadata = () => titled('Проект');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
