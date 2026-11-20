// История переносов сроков. Портал не шлёт события о смене дедлайна отдельно, но пишет
// системное сообщение в чат задачи, и оно приходит как ONTASKCOMMENTADD. Уведомления живут
// 30 дней (TTL), поэтому разобранные переносы копятся в своей коллекции без срока жизни.
import type { Db } from 'mongodb';

export type DeadlineChange = {
  member_id: string;
  messageId: string;
  taskId: string;
  actorId: string;
  /** moved: срок поставлен на новую дату, removed: срок снят. */
  kind: 'moved' | 'removed';
  /** Новый срок по часам портала, для removed пусто. */
  deadline: string;
  at: Date;
};

/** Время портала (Москва) в формате дедлайна задачи: 2026-11-20T19:00:00+03:00. */
export const portalTime = (seconds: number) =>
  `${new Date(seconds * 1000).toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).replace(' ', 'T')}+03:00`;

/**
 * Разбор системного сообщения. «Установил крайний срок» это первая постановка, а не перенос;
 * «задача просрочена» и «почти просрочена» это напоминания, у них та же ссылка changeDeadline.
 */
export function parseDeadlineChange(
  message: string,
): Pick<DeadlineChange, 'actorId' | 'kind' | 'deadline'> | null {
  if (!message.includes('chatAction=changeDeadline')) return null;
  const head = /^\[USER=(\d+)\][^[]*\[\/USER\] (изменила?|удалила?) /.exec(message);
  if (!head) return null;
  if (head[2].startsWith('удалил')) return { actorId: head[1], kind: 'removed', deadline: '' };
  const stamp = /\[TIMESTAMP=(\d+)/.exec(message);
  return stamp ? { actorId: head[1], kind: 'moved', deadline: portalTime(Number(stamp[1])) } : null;
}

type CommentNote = {
  member_id?: unknown;
  messageId?: unknown;
  taskId?: unknown;
  message?: unknown;
  created_at?: unknown;
};

/** Переносит переносы из уведомлений в свою коллекцию. Повтор безопасен: ключ это messageId. */
export async function saveDeadlineChanges(db: Db, notes: CommentNote[]) {
  const ops = notes.flatMap((note) => {
    const parsed = parseDeadlineChange(String(note.message || ''));
    if (!parsed || !note.messageId || !note.taskId) return [];
    const change: DeadlineChange = {
      member_id: String(note.member_id),
      messageId: String(note.messageId),
      taskId: String(note.taskId),
      at: note.created_at instanceof Date ? note.created_at : new Date(String(note.created_at)),
      ...parsed,
    };
    return [
      {
        updateOne: {
          filter: { member_id: change.member_id, messageId: change.messageId },
          update: { $setOnInsert: change },
          upsert: true,
        },
      },
    ];
  });
  if (ops.length) await db.collection('deadline_changes').bulkWrite(ops, { ordered: false });
}

/** Догоняет коллекцию по уведомлениям, которые обработчик событий мог не сохранить. */
export async function syncDeadlineChanges(db: Db, memberId: string) {
  const notes = await db
    .collection('notifications')
    .find({
      member_id: memberId,
      type: 'comment_added',
      message: /chatAction=changeDeadline/,
    })
    .project({ member_id: 1, messageId: 1, taskId: 1, message: 1, created_at: 1 })
    .toArray();
  await saveDeadlineChanges(db, notes);
}
