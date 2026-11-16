'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { TextField } from '@/components/monos/TextField';
import { t } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Ответ входа через Битрикс приходит редиректом с кодом причины в адресе.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('error');
    if (reason) setError(bitrixLoginError(reason));
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          next: new URLSearchParams(window.location.search).get('next'),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(
          data.error === 'TOO_MANY_ATTEMPTS'
            ? t('Слишком много попыток. Повторите через 15 минут.')
            : data.error === 'ACCOUNT_BLOCKED'
              ? t('Учётная запись заблокирована. Обратитесь к администратору.')
              : t('Неверный логин или пароль.'),
        );
        return;
      }
      router.replace(data.next || '/');
      router.refresh();
    } catch {
      setError(t('Не удалось подключиться к серверу.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-12 sm:flex sm:items-center sm:justify-center">
      <Card padding="lg" className="mx-auto w-full max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-ui bg-ink text-canvas">
              <LockKeyhole size={18} strokeWidth={1.7} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">BitrixFlow</h1>
              <p className="text-xs uppercase tracking-widest text-ink-soft">
                {t('Защищённый доступ')}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* Вход своим аккаунтом Битрикса: всё в приложении идёт от его имени. */}
            <a
              href={`/api/oauth?next=${encodeURIComponent(nextPath())}`}
              className="flex min-h-11 items-center justify-center rounded-ui bg-ink px-4 text-sm font-semibold text-canvas transition-colors duration-fast hover:bg-ink-soft"
            >
              {t('Войти через Битрикс')}
            </a>
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-5">
            <p className="text-xs text-ink-soft">
              {t('Или по паролю учётной записи. Данные откроются после подключения Битрикса.')}
            </p>
            <TextField
              label={t('Логин')}
              variant="boxed"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <TextField
              label={t('Пароль')}
              type="password"
              variant="boxed"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button full size="lg" variant="secondary" loading={isSubmitting} type="submit">
              {isSubmitting ? t('Входим…') : t('Войти')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

function nextPath() {
  if (typeof window === 'undefined') return '/';
  const next = new URLSearchParams(window.location.search).get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function bitrixLoginError(reason: string) {
  switch (reason) {
    case 'wrong_portal':
      return t('Этот аккаунт Битрикса с другого портала. Войдите аккаунтом своей компании.');
    case 'blocked':
      return t('Учётная запись заблокирована. Обратитесь к администратору.');
    case 'already_linked':
      return t('Этот аккаунт Битрикса уже привязан к другой учётной записи.');
    case 'not_portal_owner':
      return t('Вход прервался. Нажмите «Войти через Битрикс» ещё раз.');
    case 'oauth_not_configured':
      return t('Вход через Битрикс не настроен на сервере.');
    default:
      return t('Битрикс не подтвердил вход. Попробуйте ещё раз.');
  }
}
