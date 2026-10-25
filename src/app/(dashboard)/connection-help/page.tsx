'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import LoadingState from '@/components/LoadingState';
import { t } from '@/lib/i18n';

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
    return <LoadingState className="min-h-screen bg-canvas" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card padding="none" className="w-full max-w-xl">
        <div className="border-b border-line p-4">
          <div className="mb-2 flex size-11 items-center justify-center rounded-ui bg-surface-2 text-warning-text">
            <CircleAlert className="size-5" strokeWidth={1.7} />
          </div>
          <p className="text-base font-bold text-ink">{t('Нужно подключить Битрикс24')}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            {t(
              'Вход в приложение выполнен, но для этого браузера не найдено активное подключение к порталу.',
            )}
          </p>
        </div>
        <div className="flex flex-col gap-5 p-4">
          <ol className="flex flex-col gap-3 text-sm text-ink-soft">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-xs font-bold text-ink">
                1
              </span>
              <span>{t('Нажмите «Подключить Битрикс24» ниже.')}</span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-xs font-bold text-ink">
                2
              </span>
              <span>{t('Войдите в нужный портал и подтвердите доступ приложения к задачам.')}</span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-xs font-bold text-ink">
                3
              </span>
              <span>
                {t(
                  'После возврата сюда статус изменится на «подключено», а проекты загрузятся автоматически.',
                )}
              </span>
            </li>
          </ol>
          <Notice tone="success" title={t('Два разных уровня доступа')}>
            <span className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4" strokeWidth={1.7} />
              {t('Ваш пароль приложения и доступ Bitrix — разные уровни авторизации.')}
            </span>
            <span className="mt-1 block pl-6">
              {t(
                'Webhook подтверждает доставку событий, но сам по себе не создаёт доступ к данным в этом браузере.',
              )}
            </span>
          </Notice>
          <Button
            full
            size="lg"
            onClick={() => {
              window.location.href = '/api/oauth';
            }}
            icon={<CheckCircle2 size={16} strokeWidth={1.7} />}
            trailing={<ArrowRight size={16} strokeWidth={1.7} />}
          >
            {t('Подключить Битрикс24')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
