'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Modal } from '@/components/monos/Modal';
import { Notice } from '@/components/monos/Notice';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
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
};

const WHEN = dateFormat({ dateStyle: 'medium', timeStyle: 'short' });

// Пароль без похожих символов (0/O, 1/l): его диктуют вслух и набирают руками.
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => alphabet[byte % 54]).join(
    '',
  );
}

const problems: Record<string, () => string> = {
  BAD_USERNAME: () =>
    t('Логин: от 2 до 64 символов, латиница, цифры и . _ @ -, начинается с буквы или цифры.'),
  PASSWORD_TOO_SHORT: () => t('Пароль короче 12 символов.'),
  BAD_PASSWORD: () => t('Пароль не подходит.'),
  USERNAME_TAKEN: () => t('Такой логин уже есть.'),
  SELF_LOCKOUT: () => t('Себя заблокировать, удалить или лишить прав нельзя.'),
  LAST_ADMIN: () => t('Это последний активный администратор.'),
  NOT_FOUND: () => t('Учётной записи уже нет.'),
};

export default function AccountsPage() {
  const confirm = useConfirm();
  const toasts = useTaskToasts();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/users');
    if (response.status === 403) return setForbidden(true);
    if (response.ok) setAccounts((await response.json()).users);
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

  function openCreate() {
    setUsername('');
    setRole('user');
    setPassword(generatePassword());
    setError('');
    setCreating(true);
  }

  async function create() {
    if (!(await call('/api/admin/users', 'POST', { username, role, password }))) return;
    toasts.saved(t('Учётная запись создана'));
    setCreating(false);
    void load();
  }

  async function resetPassword() {
    if (!resetting || !(await call(`/api/admin/users/${resetting.id}`, 'PATCH', { password })))
      return;
    toasts.saved(t('Пароль сброшен, открытые сессии закрыты'));
    setResetting(null);
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
          'Личные логины для входа в приложение: доступ к порталу остаётся на сервере',
        )}
        actions={
          <Button size="sm" icon={<Plus size={14} strokeWidth={1.7} />} onClick={openCreate}>
            {t('Добавить')}
          </Button>
        }
      />
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        {forbidden ? (
          <Notice tone="danger">{t('Раздел доступен только администраторам.')}</Notice>
        ) : !accounts ? (
          <LoadingState label={t('Загрузка…')} />
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span className="truncate">{account.username}</span>
                      {account.role === 'admin' && (
                        <Badge tone="accent">{t('Администратор')}</Badge>
                      )}
                      {account.blocked && <Badge tone="danger">{t('Заблокирован')}</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
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
                      onClick={() => {
                        setPassword(generatePassword());
                        setError('');
                        setResetting(account);
                      }}
                    >
                      {t('Сбросить пароль')}
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
                    <Button
                      size="sm"
                      variant="secondary"
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

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('Новая учётная запись')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t('Отмена')}
            </Button>
            <Button
              onClick={() => void create()}
              disabled={!username.trim() || busy}
              loading={busy}
            >
              {t('Создать')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField
            variant="boxed"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-label={t('Логин')}
            placeholder={t('Логин')}
            autoComplete="off"
          />
          <TextField
            variant="boxed"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-label={t('Пароль')}
            autoComplete="off"
          />
          <p className="text-xs text-ink-soft">
            {t('Пароль виден только сейчас: скопируйте его и передайте человеку.')}
          </p>
          <SelectField
            variant="boxed"
            aria-label={t('Роль')}
            value={role}
            onChange={(event) => setRole(event.target.value as 'user' | 'admin')}
            options={[
              { value: 'user', label: t('Сотрудник') },
              { value: 'admin', label: t('Администратор') },
            ]}
          />
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </Modal>

      <Modal
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title={t('Сбросить пароль: {0}', resetting?.username ?? '')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetting(null)}>
              {t('Отмена')}
            </Button>
            <Button onClick={() => void resetPassword()} disabled={busy} loading={busy}>
              {t('Сохранить')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField
            variant="boxed"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-label={t('Пароль')}
            autoComplete="off"
          />
          <p className="text-xs text-ink-soft">
            {t('Пароль виден только сейчас: скопируйте его и передайте человеку.')}
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </Modal>
    </div>
  );
}
