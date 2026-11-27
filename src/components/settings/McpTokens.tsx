'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { TextField } from '@/components/monos/TextField';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { useTaskToasts } from '@/components/monos/toast';
import LoadingState from '@/components/LoadingState';
import { dateFormat, t } from '@/lib/i18n';

type Token = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  oauth: boolean;
};

// Личный раздел, в отличие от остальных настроек: каждый выпускает и отзывает только свои
// токены. Коннекторы claude.ai и ChatGPT появляются здесь же после согласия, их тоже можно отозвать.
export default function McpTokens() {
  const toasts = useTaskToasts();
  const confirm = useConfirm();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState('');
  const [busy, setBusy] = useState(false);
  // Адрес из window только после монтирования: при серверном рендере его нет.
  const [endpoint, setEndpoint] = useState('');

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/mcp-tokens');
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      setTokens((await response.json()).tokens);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/mcp`);
    void load();
  }, [load]);

  async function issue() {
    setBusy(true);
    try {
      const response = await fetch('/api/mcp-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP_${response.status}`);
      setFresh(data.token);
      setName('');
      await load();
    } catch (error) {
      toasts.failed(t('Не удалось выпустить токен'), error);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: Token) {
    const ok = await confirm({
      title: t('Отозвать доступ «{0}»?', token.name),
      description: t('Клиент MCP с этим доступом перестанет работать сразу.'),
      confirmLabel: t('Отозвать'),
      destructive: true,
    });
    if (!ok) return;
    const response = await fetch(`/api/mcp-tokens?id=${encodeURIComponent(token.id)}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      toasts.saved(t('Доступ отозван'));
      await load();
    } else toasts.failed(t('Не удалось выполнить действие.'));
  }

  const format = dateFormat({ day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{t('Токены MCP')}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {t(
            'Доступ ИИ-агентов к задачам и реестру проектов BitrixFlow. Коннекторы claude.ai и ChatGPT подключаются по адресу сервера сами, CLI и IDE берут личный токен',
          )}
        </p>
      </div>
      <Card className="space-y-5">
        <div className="space-y-1">
          <p className="text-xs tracking-widest text-ink-soft uppercase">{t('Адрес сервера')}</p>
          <code className="block break-all text-sm text-ink">{endpoint}</code>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField
              label={t('Название токена')}
              variant="boxed"
              placeholder="Claude Code"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button loading={busy} onClick={() => void issue()}>
            {t('Выпустить токен')}
          </Button>
        </div>
        {fresh ? (
          <Notice tone="success">
            <span className="block">
              {t('Скопируйте токен сейчас: второй раз его не показать.')}
            </span>
            <code className="mt-2 block break-all text-sm">{fresh}</code>
            <code className="mt-2 block break-all text-xs text-ink-soft">
              {`claude mcp add --transport http bitrixflow ${endpoint} --header "Authorization: Bearer ${fresh}"`}
            </code>
          </Notice>
        ) : null}
      </Card>
      {!tokens && loadFailed ? (
        <Notice tone="danger">
          {t('Не удалось загрузить настройки.')}{' '}
          <Button size="sm" variant="text" onClick={() => void load()}>
            {t('Повторить')}
          </Button>
        </Notice>
      ) : !tokens ? (
        <LoadingState compact />
      ) : tokens.length ? (
        <Card padding="none" className="divide-y divide-line">
          {tokens.map((token) => (
            <div key={token.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{token.name}</p>
                <p className="text-xs text-ink-soft">
                  {token.oauth ? t('Коннектор OAuth') : t('Личный токен')}
                  {' · '}
                  {t('Выпущен {0}', format.format(new Date(token.createdAt)))}
                  {' · '}
                  {token.lastUsedAt
                    ? t('Использован {0}', format.format(new Date(token.lastUsedAt)))
                    : t('Ещё не использовался')}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void revoke(token)}>
                {t('Отозвать')}
              </Button>
            </div>
          ))}
        </Card>
      ) : (
        <p className="text-sm text-ink-soft">{t('Токенов пока нет.')}</p>
      )}
    </section>
  );
}
