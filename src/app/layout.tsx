import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Inter } from 'next/font/google';
import { cn } from '@/lib/utils';

// Inter: профессиональный современный шрифт с полной поддержкой кириллицы.
// Используем display=swap, чтобы текст не блокировал первый рендер.
const inter = Inter({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BitrixFlow',
  description: 'BitrixFlow — управление задачами, проектами и процессами Bitrix24.',
  applicationName: 'BitrixFlow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={cn('font-sans', inter.variable)} suppressHydrationWarning>
      <body className="h-full antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const saved = localStorage.getItem('bitrix-flow-theme'); const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.classList.toggle('dark', dark); } catch {} })()`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
