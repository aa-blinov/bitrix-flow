'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import LoadingState from '@/components/LoadingState';

export default function ConnectionHelpPage() {
  const [state, setState] = useState<'checking' | 'disconnected'>('checking');

  useEffect(() => {
    const memberId = localStorage.getItem('bitrix_member_id') || '';
    fetch('/api/oauth/check', { credentials: 'include', headers: { 'X-Member-Id': memberId } })
      .then((response) => response.json())
      .then((data) => {
        if (data.session === false) {
          window.location.replace('/login');
          return;
        }
        if (data.connected) window.location.replace('/');
        else setState('disconnected');
      })
      .catch(() => setState('disconnected'));
  }, []);

  if (state === 'checking') {
    return <LoadingState className="min-h-screen bg-muted/30" />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-xl shadow-sm">
        <CardHeader className="border-b bg-muted/20">
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <CircleAlert className="size-6" />
          </div>
          <CardTitle>Нужно подключить Битрикс24</CardTitle>
          <CardDescription>
            Вход в приложение выполнен, но для этого браузера не найдено активное подключение к
            порталу.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                1
              </span>
              <span>Нажмите «Подключить Битрикс24» ниже.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                2
              </span>
              <span>Войдите в нужный портал и подтвердите доступ приложения к задачам.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                3
              </span>
              <span>
                После возврата сюда статус изменится на «подключено», а проекты загрузятся
                автоматически.
              </span>
            </li>
          </ol>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <span className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4" />
              Ваш пароль приложения и доступ Bitrix — разные уровни авторизации.
            </span>
            <p className="mt-1 pl-6 text-emerald-700">
              Webhook подтверждает доставку событий, но сам по себе не создаёт доступ к данным в
              этом браузере.
            </p>
          </div>
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              window.location.href = '/api/oauth';
            }}
          >
            <CheckCircle2 />
            Подключить Битрикс24
            <ArrowRight />
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
