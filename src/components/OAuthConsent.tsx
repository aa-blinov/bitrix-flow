'use client';

import { useState } from 'react';
import { PlugZap } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { t } from '@/lib/i18n';

type Request = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  resource: string;
};

const PROBLEMS = () => ({
  person: t(
    'Учётная запись не привязана к Битриксу: войдите через Битрикс и повторите подключение.',
  ),
  client: t(
    'Клиент не зарегистрирован или адрес возврата не совпадает. Начните подключение заново.',
  ),
  request: t('Запрос на подключение неполный. Начните подключение заново.'),
});

export default function OAuthConsent({
  problem,
  clientName,
  redirectHost,
  personName,
  request,
}: {
  problem: 'person' | 'client' | 'request' | null;
  clientName: string;
  redirectHost: string;
  personName: string;
  request: Request;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/mcp-oauth/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, approve }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.redirect) throw new Error(`HTTP_${response.status}`);
      window.location.assign(data.redirect);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-12 sm:flex sm:items-center sm:justify-center">
      <Card padding="lg" className="mx-auto w-full max-w-md">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-ui bg-ink text-canvas">
              <PlugZap size={18} strokeWidth={1.7} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">BitrixFlow</h1>
              <p className="text-xs uppercase tracking-widest text-ink-soft">
                {t('Подключение MCP')}
              </p>
            </div>
          </div>

          {problem ? (
            <Notice tone="danger">{PROBLEMS()[problem]}</Notice>
          ) : (
            <>
              <div className="flex flex-col gap-2 text-sm text-ink">
                <p>{t('{0} просит доступ к BitrixFlow от имени {1}.', clientName, personName)}</p>
                <p className="text-ink-soft">
                  {t(
                    'Чтение задач, личного плана, реестра проектов, часов, нагрузки и отчётов. Записывать клиент сможет только статусы проектов в реестре и план спринта (перенос задач и их размер), сами задачи он не изменит.',
                  )}
                </p>
                <p className="text-ink-soft">
                  {t('После согласия вы вернётесь на {0}.', redirectHost)}
                </p>
              </div>
              {failed ? <Notice tone="danger">{t('Не удалось выполнить действие.')}</Notice> : null}
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <Button full size="lg" loading={busy} onClick={() => decide(true)}>
                  {t('Разрешить')}
                </Button>
                <Button
                  full
                  size="lg"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => decide(false)}
                >
                  {t('Отклонить')}
                </Button>
              </div>
              <p className="text-xs text-ink-soft">
                {t('Отозвать доступ можно в настройках, в разделе «Токены MCP».')}
              </p>
            </>
          )}
        </div>
      </Card>
    </main>
  );
}
