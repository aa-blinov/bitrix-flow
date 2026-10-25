'use client';
import { useEffect, useState } from 'react';
import { Plug, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { t } from '@/lib/i18n';

export default function ConnectPage() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [domain, setDomain] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);

  async function checkStatus() {
    try {
      const res = await fetch('/api/oauth/check', {
        headers: { 'X-Member-Id': localStorage.getItem('bitrix_member_id') || '' },
      });
      const data = (await res.json()) as {
        connected?: boolean;
        member_id?: string;
        domain?: string;
      };

      if (data.connected && data.member_id) {
        localStorage.setItem('bitrix_member_id', data.member_id);
        setMemberId(data.member_id);
        setStatus('connected');
        if (data.domain) setDomain(data.domain);
        return data;
      }
      setStatus('error');
      return null;
    } catch {
      setStatus('error');
      return null;
    }
  }

  useEffect(() => {
    // Проверяем OAuth success в URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('install') === 'success' || params.get('oauth') === 'success') {
      // Получаем member_id с сервера
      void checkStatus().then((data) => {
        if (data?.member_id) {
          const next = sessionStorage.getItem('bitrix-connect-next') || '/';
          sessionStorage.removeItem('bitrix-connect-next');
          window.location.replace(next.startsWith('/') ? next : '/');
        }
      });
      return;
    }

    void checkStatus();
  }, []);

  const handleConnect = () => {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next?.startsWith('/')) sessionStorage.setItem('bitrix-connect-next', next);
    window.location.href = '/api/oauth';
  };

  return (
    <div className="min-h-screen bg-canvas p-4 lg:p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-xl font-bold tracking-tight text-ink">
          {t('Подключение к Битрикс24')}
        </h1>
        <p className="mb-8 text-sm text-ink-soft">
          {t('Подключите свой аккаунт Битрикс24 для управления задачами')}
        </p>

        <Card padding="none">
          <div className="flex items-center gap-4 border-b border-line p-4">
            <div className="flex size-12 items-center justify-center rounded-ui bg-surface-2">
              {status === 'connected' ? (
                <CheckCircle2 className="text-success-text" size={22} strokeWidth={1.7} />
              ) : status === 'loading' ? (
                <RefreshCw className="animate-spin text-ink-muted" size={22} strokeWidth={1.7} />
              ) : (
                <Plug className="text-ink-muted" size={22} strokeWidth={1.7} />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-ink">
                {status === 'connected'
                  ? t('Подключено')
                  : status === 'loading'
                    ? t('Загрузка…')
                    : t('Не подключено')}
              </p>
              {domain ? <p className="mt-0.5 text-xs text-ink-soft">{domain}</p> : null}
              {memberId ? (
                <Badge tone="neutral" className="mt-2">
                  OAuth ID {memberId}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="p-4">
            <Button
              full
              size="lg"
              onClick={handleConnect}
              trailing={<ArrowRight size={16} strokeWidth={1.7} />}
            >
              {status === 'connected' ? t('Переподключить') : t('Подключить Битрикс24')}
            </Button>
          </div>
        </Card>

        <Card padding="none" className="mt-6">
          <div className="border-b border-line p-4">
            <p className="text-sm font-bold text-ink">{t('Как это работает')}</p>
          </div>
          <ul className="flex flex-col gap-1 p-4 text-sm text-ink-soft">
            <li>{t('Запросы от вашего имени (нет лимитов)')}</li>
            <li>{t('Real-time обновления через webhook')}</li>
            <li>{t('Автоматический refresh токена')}</li>
            <li>{t('Безопасное хранение в MongoDB')}</li>
            <li>{t('Webhook больше НЕ используется')}</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
