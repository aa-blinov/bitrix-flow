import type { Metadata, Viewport } from 'next';
import './globals.css';
import { JetBrains_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';
import { ToastProvider } from '@/components/monos/toast';
import { ConfirmProvider } from '@/components/monos/confirm-dialog';
import { ThemeProvider } from '@/components/monos/theme';
import LocaleProvider from '@/components/LocaleProvider';

// JetBrains Mono — единственная гарнитура в наборе @monos/ui. Подгружается
// с кириллицей, потому что весь интерфейс приложения русский.
const jetbrains = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains',
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
    <html lang="ru" className={cn('font-ui', jetbrains.variable)} suppressHydrationWarning>
      <body className="h-full antialiased">
        {/* Тема ставится до первой отрисовки, иначе страница моргает белым.
            Набор из @monos/ui различает палитру и режим атрибутами
            `[data-theme]` и `[data-mode]`. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try {
              const saved = localStorage.getItem('bitrix-flow-theme');
              const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
              let theme = 'gruvbox';
              let mode = prefersDark ? 'dark' : 'light';
              if (saved) {
                const parts = saved.split(':');
                if (parts[0] && parts[0] !== 'mode') theme = parts[0];
                if (parts[1] === 'dark' || parts[1] === 'light') mode = parts[1];
                else if (saved === 'dark' || saved === 'light') mode = saved;
              }
              const el = document.documentElement;
              el.setAttribute('data-theme', theme);
              el.setAttribute('data-mode', mode);
            } catch {} })()`,
          }}
        />
        {/* Английский включается после монтирования (LocaleProvider), а до этого страница
            спрятана, чтобы не мелькал русский. Если скрипт не отработает, через три секунды
            страница откроется как есть. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try {
              if (/(?:^|; )bitrix-flow-locale=en/.test(document.cookie)) {
                const el = document.documentElement;
                el.setAttribute('data-locale-pending', '');
                setTimeout(() => el.removeAttribute('data-locale-pending'), 3000);
              }
            } catch {} })()`,
          }}
        />
        <LocaleProvider>
          <ThemeProvider>
            <ToastProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </ToastProvider>
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
