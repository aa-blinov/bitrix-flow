'use client';
import { useEffect, useRef, useState } from 'react';
import { Bx24User } from '@/types/bitrix';
import { Button } from '@/components/monos/Button';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { t } from '@/lib/i18n';

// Inline-add: форма создания задачи прямо в колонке, без модалки. После
// успешной отправки очищает поле и остаётся открытым — так удобнее
// добавлять несколько задач подряд.
export function InlineAddForm({
  onSubmit,
  onCancel,
  users,
  defaultAssigneeId,
}: {
  onSubmit: (data: { title: string; assigneeId: string; priority: string }) => Promise<boolean>;
  onCancel: () => void;
  users: Bx24User[];
  defaultAssigneeId?: string;
}) {
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId || '');
  const [priority, setPriority] = useState('medium');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const ok = await onSubmit({ title: trimmed, assigneeId, priority });
    setSubmitting(false);
    if (ok) {
      setTitle('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="rounded-ui border border-line bg-canvas p-2 shadow-rest">
      <TextField
        ref={inputRef}
        variant="boxed"
        size="sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={t('Название задачи…')}
        aria-label={t('Название задачи')}
        disabled={submitting}
      />
      <div className="mt-2 flex items-center gap-1">
        <SelectField
          value={assigneeId || 'unassigned'}
          onChange={(event) =>
            setAssigneeId(event.target.value === 'unassigned' ? '' : event.target.value)
          }
          options={[
            { value: 'unassigned', label: t('Без исполнителя') },
            ...users.map((u) => ({ value: u.id, label: u.name })),
          ]}
          size="sm"
          disabled={submitting}
          className="min-w-0 flex-1"
          aria-label={t('Исполнитель')}
        />
        <SelectField
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          options={[
            { value: 'low', label: t('Низкий') },
            { value: 'medium', label: t('Обычный') },
            { value: 'high', label: t('Высокий') },
          ]}
          size="sm"
          className="w-24"
          aria-label={t('Приоритет')}
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button size="md" variant="quiet" onClick={onCancel} disabled={submitting}>
          {t('Отмена')}
        </Button>
        <Button size="md" onClick={() => void submit()} disabled={!title.trim() || submitting}>
          {submitting ? '…' : t('Создать')}
        </Button>
      </div>
    </div>
  );
}
