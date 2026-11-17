'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { useTaskToasts } from '@/components/monos/toast';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { dateFormat, t } from '@/lib/i18n';

type Account = {
  id: string;
  username: string;
  role: 'admin' | 'user';
  blocked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  bitrixUserId: string | null;
  displayName: string | null;
};

const WHEN = dateFormat({ dateStyle: 'medium', timeStyle: 'short' });

const problems: Record<string, () => string> = {
  SELF_LOCKOUT: () => t('Себя заблокировать, удалить или лишить прав нельзя.'),
  LAST_ADMIN: () => t('Это последний активный администратор.'),
  NOT_FOUND: () => t('Учётной записи уже нет.'),
};

export default function AccountsPage() {
  const confirm = useConfirm();
  const toasts = useTaskToasts();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/admin/users');
      if (response.status === 403) return setForbidden(true);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      setAccounts((await response.json()).users);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Один запрос к админскому API: ошибка показывается человеку словами, а не кодом.
  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.ok) return true;
      const code = (await response.json().catch(() => null))?.error;
      setError(problems[code]?.() ?? t('Не удалось выполнить действие.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function patch(account: Account, change: Record<string, unknown>, saved: string) {
    if (!(await call(`/api/admin/users/${account.id}`, 'PATCH', change))) {
      toasts.failed(t('Не удалось выполнить действие.'));
      return;
    }
    toasts.saved(saved);
    void load();
  }

  async function remove(account: Account) {
    const agreed = await confirm({
      title: t('Удалить учётную запись {0}?', account.username),
      description: t('Человек потеряет доступ сразу, его открытые сессии закроются.'),
      confirmLabel: t('Удалить'),
      destructive: true,
    });
    if (!agreed) return;
    if (await call(`/api/admin/users/${account.id}`, 'DELETE')) void load();
    else toasts.failed(t('Не удалось выполнить действие.'));
  }

  return (
    <div className="min-h-screen bg-canvas">
      <PageHeader
        title={t('Учётные записи')}
        description={t(
          'Люди, которые входили через Битрикс. Учётка создаётся сама при первом входе, здесь доступ можно закрыть или дать права администратора',
        )}
      />
      <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-6">
        {error && <Notice tone="danger">{error}</Notice>}
        {forbidden ? (
          <Notice tone="danger">{t('Раздел доступен только администраторам.')}</Notice>
        ) : !accounts && loadFailed ? (
          <Notice tone="danger">
            {t('Не удалось загрузить учётные записи.')}{' '}
            <Button size="sm" variant="text" onClick={() => void load()}>
              {t('Повторить')}
            </Button>
          </Notice>
        ) : !accounts ? (
          <LoadingState label={t('Загрузка…')} />
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span className="truncate">{account.displayName || account.username}</span>
                      {account.role === 'admin' && (
                        <Badge tone="accent">{t('Администратор')}</Badge>
                      )}
                      {account.blocked && <Badge tone="danger">{t('Заблокирован')}</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {/* От чьего имени эта учётка действует в Битриксе. */}
                      {account.bitrixUserId
                        ? t('Битрикс: #{0}', account.bitrixUserId)
                        : t('Битрикс не подключён')}
                      {' · '}
                      {account.lastLoginAt
                        ? t('Вход: {0}', WHEN.format(new Date(account.lastLoginAt)))
                        : t('Ещё не входил')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void patch(
                          account,
                          { blocked: !account.blocked },
                          account.blocked
                            ? t('Учётная запись разблокирована')
                            : t('Учётная запись заблокирована'),
                        )
                      }
                    >
                      {account.blocked ? t('Разблокировать') : t('Заблокировать')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void patch(
                          account,
                          { role: account.role === 'admin' ? 'user' : 'admin' },
                          t('Роль изменена'),
                        )
                      }
                    >
                      {account.role === 'admin' ? t('Снять права') : t('Сделать администратором')}
                    </Button>
                    {/* Необратимое действие отделено и красное: в одном ряду с «Заблокировать»
                        его легко нажать вместо соседа. */}
                    <Button
                      size="sm"
                      variant="danger"
                      className="sm:ml-4"
                      disabled={busy}
                      onClick={() => void remove(account)}
                    >
                      {t('Удалить')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
