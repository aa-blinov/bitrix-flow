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
  // %s подставляет заголовок страницы: вкладки перестают быть одинаковыми.
  title: { default: 'BitrixFlow', template: '%s — BitrixFlow' },
  description: 'BitrixFlow — управление задачами, проектами и процессами Bitrix24.',
  applicationName: 'BitrixFlow',
  // Данные портала за логином: поисковикам тут делать нечего.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Зум не блокируем: maximum-scale=1 ломает увеличение текста на телефоне
  // (WCAG 1.4.4) и ничего не давало взамен.
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
