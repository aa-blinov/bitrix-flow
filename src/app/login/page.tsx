'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { TextField } from '@/components/monos/TextField';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
            ? 'Слишком много попыток. Повторите через 15 минут.'
            : 'Неверный логин или пароль.',
        );
        return;
      }
      router.replace(data.next || '/');
      router.refresh();
    } catch {
      setError('Не удалось подключиться к серверу.');
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
              <p className="text-xs uppercase tracking-widest text-ink-soft">Защищённый доступ</p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <TextField
              label="Логин"
              variant="boxed"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <TextField
              label="Пароль"
              type="password"
              variant="boxed"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button full size="lg" loading={isSubmitting} type="submit">
              {isSubmitting ? 'Входим…' : 'Войти'}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
