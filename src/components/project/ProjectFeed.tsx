'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import BitrixText from '@/components/BitrixText';
import LoadingState from '@/components/LoadingState';
import { Avatar } from '@/components/monos/Avatar';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { dateFormat, t } from '@/lib/i18n';
import type { FeedPost } from '@/lib/project-life';
import { useKanbanStore } from '@/store/kanban';

const WHEN = dateFormat({ day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Лента проекта из живой ленты портала: посты группы и новый пост в неё. */
export default function ProjectFeed({
  projectId,
  toolbar,
}: {
  projectId: string;
  toolbar: ReactNode;
}) {
  const users = useKanbanStore((state) => state.users);
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/feed?projectId=${projectId}`);
      if (!response.ok) throw new Error();
      setPosts((await response.json()).posts || []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/projects/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title, text }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || '');
      setTitle('');
      setText('');
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t('Не удалось опубликовать пост'),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 lg:px-6">{toolbar}</div>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 lg:px-6">
        <form
          aria-label={t('Новый пост')}
          className="space-y-2 rounded-ui border border-line bg-surface p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <TextField
            variant="underline"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('Заголовок, если нужен')}
            aria-label={t('Заголовок поста')}
          />
          <TextArea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('Напишите участникам проекта…')}
            aria-label={t('Текст поста')}
          />
          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!text.trim() || sending}>
              {t('Опубликовать')}
            </Button>
          </div>
        </form>

        {failed ? (
          <p role="alert" className="py-6 text-center text-danger-text">
            {t('Не удалось загрузить ленту проекта.')}
          </p>
        ) : !posts ? (
          <LoadingState />
        ) : posts.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">
            {t('В ленте проекта пока пусто. Первый пост увидят все участники.')}
          </p>
        ) : (
          <ul aria-label={t('Лента проекта')} className="space-y-3">
            {posts.map((post) => {
              const author = users.find((user) => user.id === post.authorId);
              const name = author?.name || t('Пользователь #{0}', post.authorId);
              return (
                <li key={post.id} className="rounded-ui border border-line bg-canvas p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <Avatar name={name} src={author?.icon} size="sm" />
                    <span className="font-medium text-ink">{name}</span>
                    {post.important && <Badge tone="warning">{t('Важное')}</Badge>}
                    {post.date && (
                      <span className="ml-auto text-xs text-ink-soft">
                        {WHEN.format(new Date(post.date))}
                      </span>
                    )}
                  </div>
                  {post.title && <h3 className="mb-1 font-bold text-ink">{post.title}</h3>}
                  <div className="text-sm break-words text-ink">
                    <BitrixText text={post.text} />
                  </div>
                  {post.comments > 0 && (
                    <p className="mt-2 text-xs text-ink-soft">
                      {t('Комментариев: {0}', post.comments)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
