import { Plug } from 'lucide-react';
import { Card } from '@/components/monos/Card';
import { t } from '@/lib/i18n';

// Вход выполнен, но Битрикс не подключён: данные закрыты целиком, потому что всё в
// приложении идёт от имени человека, а чужим токеном мы не ходим.
export default function BitrixConnectGate() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-12 sm:flex sm:items-center sm:justify-center">
      <Card padding="lg" className="mx-auto flex w-full max-w-sm flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-ui bg-ink text-canvas">
            <Plug size={18} strokeWidth={1.7} />
          </div>
          <h1 className="text-lg font-bold text-ink">{t('Подключите Битрикс')}</h1>
        </div>
        <p className="text-sm text-ink-soft">
          {t(
            'Задачи, отчёты и сообщения открываются от имени вашего аккаунта Битрикса. Подключите его один раз, дальше вход будет через Битрикс.',
          )}
        </p>
        <a
          href="/api/oauth?next=%2F"
          className="flex min-h-11 items-center justify-center rounded-ui bg-ink px-4 text-sm font-semibold text-canvas transition-colors duration-fast hover:bg-ink-soft"
        >
          {t('Подключить Битрикс')}
        </a>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="min-h-11 w-full text-sm text-ink-soft underline hover:text-ink"
          >
            {t('Выйти')}
          </button>
        </form>
      </Card>
    </main>
  );
}
