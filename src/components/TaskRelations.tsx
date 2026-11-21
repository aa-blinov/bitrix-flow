'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Link2, X } from 'lucide-react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { IconButton } from '@/components/monos/IconButton';
import { TextField } from '@/components/monos/TextField';
import {
  fetchTaskRelations,
  searchProjectTasks,
  updateTaskFull,
  type Bx24Task,
  type RelatedTask,
} from '@/lib/bitrix24';
import { NO_PROJECT_ID } from '@/lib/no-project';
import { t } from '@/lib/i18n';

const DONE = '5';
const href = (task: RelatedTask) =>
  `/projects/${task.groupId && task.groupId !== '0' ? task.groupId : NO_PROJECT_ID}?task=${task.id}`;

function RelatedRow({ task, onRemove }: { task: RelatedTask; onRemove?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-ui border border-line bg-surface-2 px-2 py-1 text-sm">
      <Link
        href={href(task)}
        className={`min-w-0 truncate hover:underline ${task.status === DONE ? 'text-ink-faint line-through' : 'text-ink'}`}
      >
        #{task.id} {task.title}
      </Link>
      {onRemove && (
        <IconButton
          label={t('Убрать связь с #{0}', task.id)}
          variant="ghost"
          size="sm"
          onClick={onRemove}
        >
          <X size={14} strokeWidth={1.7} />
        </IconButton>
      )}
    </div>
  );
}

/**
 * «Связанные задачи» портала (поле DEPENDS_ON): от чего зависит задача и кто ждёт её.
 * Связи Ганта сюда не попадают: REST их не отдаёт.
 */
export default function TaskRelations({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const [relations, setRelations] = useState<{
    dependsOn: RelatedTask[];
    blocks: RelatedTask[];
  } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Bx24Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetchTaskRelations(taskId)
      .then(setRelations)
      .catch(() => setRelations({ dependsOn: [], blocks: [] }));
  }, [taskId]);
  useEffect(load, [load]);

  useEffect(() => {
    const text = query.trim();
    if (!(/^\d+$/.test(text) || text.length >= 2)) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchProjectTasks(projectId, text).then((found) => {
        if (!cancelled) setResults(found);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, projectId]);

  const save = async (ids: string[]) => {
    setSaving(true);
    setError(null);
    try {
      await updateTaskFull(taskId, { dependsOn: ids.map(Number) });
      load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Не удалось сохранить связь'));
    } finally {
      setSaving(false);
    }
  };

  const dependsOn = relations?.dependsOn || [];
  const open = dependsOn.filter((task) => task.status && task.status !== DONE).length;
  const taken = new Set([taskId, ...dependsOn.map((task) => task.id)]);

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
        <Link2 size={12} strokeWidth={1.7} /> {t('Связанные задачи')}
        {open > 0 && (
          <Badge tone="warning" className="ml-auto normal-case tracking-normal">
            {t('Ждёт задач: {0}', open)}
          </Badge>
        )}
      </p>
      {relations && (
        <div className="space-y-1.5">
          {dependsOn.map((task) => (
            <RelatedRow
              key={task.id}
              task={task}
              onRemove={
                saving
                  ? undefined
                  : () =>
                      void save(
                        dependsOn.filter((item) => item.id !== task.id).map((item) => item.id),
                      )
              }
            />
          ))}
          {relations.blocks.length > 0 && (
            <>
              <p className="pt-1 text-whisper text-ink-faint">{t('Эту задачу ждут')}</p>
              {relations.blocks.map((task) => (
                <RelatedRow key={task.id} task={task} />
              ))}
            </>
          )}
        </div>
      )}
      <div className="relative mt-1.5">
        <TextField
          variant="underline"
          value={query}
          disabled={saving}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Добавить связь: название или ID…')}
          aria-label={t('Добавить связанную задачу')}
        />
        {query && results.length > 0 && (
          <div className="absolute z-menu mt-1 max-h-48 w-full overflow-y-auto rounded-ui border border-line bg-canvas p-1 shadow-overlay">
            {results
              .filter((candidate) => !taken.has(candidate.id))
              .slice(0, 10)
              .map((candidate) => (
                <Button
                  key={candidate.id}
                  variant="quiet"
                  size="sm"
                  className="h-auto w-full justify-start px-2 py-1.5 text-left"
                  onClick={() => {
                    setQuery('');
                    void save([...dependsOn.map((item) => item.id), candidate.id]);
                  }}
                >
                  #{candidate.id}, {candidate.title}
                </Button>
              ))}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-danger-text">{error}</p>}
    </div>
  );
}
