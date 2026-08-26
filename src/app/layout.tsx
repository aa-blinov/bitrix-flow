import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Bitrix24 Project Manager',
  description: 'Professional project management interface for Bitrix24',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)} suppressHydrationWarning>
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
