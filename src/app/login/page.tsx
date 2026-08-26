'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
    <main className="min-h-screen bg-slate-950 px-4 py-12 sm:flex sm:items-center sm:justify-center">
      <Card className="mx-auto w-full max-w-sm bg-card shadow-2xl">
        <form onSubmit={onSubmit}>
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <LockKeyhole size={19} />
            </div>
            <div>
              <CardTitle>Bitrix24 PM</CardTitle>
              <p className="text-sm text-muted-foreground">Защищённый доступ</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm font-medium">
              Логин
              <Input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1.5"
              />
            </label>
            <label className="block text-sm font-medium">
              Пароль
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5"
              />
            </label>
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button disabled={isSubmitting} className="w-full" size="lg">
              {isSubmitting ? 'Входим…' : 'Войти'}
            </Button>
          </CardContent>
        </form>
      </Card>
    </main>
  );
}
