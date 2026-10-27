// Пуши в закрытую вкладку. Уведомление браузера (Notification) живёт только пока вкладка
// открыта, а упоминание нужно увидеть и тогда, когда приложение закрыто: для этого браузер
// держит service worker и принимает пуш от своего push-сервиса. Зависимость web-push нужна
// ради шифрования полезной нагрузки и подписи VAPID: руками это писать не стоит.
import webpush from 'web-push';
import { bitrixPlainText } from './bitrix-markup';
import { getDb } from './mongo';
import { bx24OAuth } from './oauth-client';
import { mentionsUser } from './ping';

export type PushPayload = {
  title: string;
  body: string;
  /** Одинаковый tag заменяет прежнее уведомление, а не копит их. */
  tag: string;
  url: string;
  /** Упоминание не исчезает само, пока человек его не закроет. */
  urgent: boolean;
};

type StoredSubscription = {
  member_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  created_at: Date;
};

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
}

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

async function subscriptions() {
  return (await getDb()).collection<StoredSubscription>('push_subscriptions');
}

export async function saveSubscription(
  memberId: string,
  subscription: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } },
): Promise<boolean> {
  const { endpoint, keys } = subscription;
  // Адрес push-сервиса приходит от клиента, а сервер потом шлёт на него запросы:
  // принимаем только https, иначе это способ заставить сервер ходить куда угодно.
  if (
    typeof endpoint !== 'string' ||
    !/^https:\/\//.test(endpoint) ||
    endpoint.length > 1000 ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string'
  )
    return false;
  await (
    await subscriptions()
  ).updateOne(
    { endpoint },
    {
      $set: { member_id: memberId, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true },
  );
  return true;
}

export async function removeSubscription(memberId: string, endpoint: string) {
  await (await subscriptions()).deleteOne({ endpoint, member_id: memberId });
}

export async function hasSubscriptions(memberId: string): Promise<boolean> {
  return Boolean(await (await subscriptions()).findOne({ member_id: memberId }));
}

/** Рассылает пуш по всем устройствам человека; мёртвые подписки (404, 410) удаляются. */
export async function sendPush(memberId: string, payload: PushPayload) {
  if (!pushConfigured()) return;
  configure();
  const collection = await subscriptions();
  const body = JSON.stringify(payload);
  const list = await collection.find({ member_id: memberId }).toArray();
  await Promise.all(
    list.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          body,
          { TTL: 60 * 60, urgency: payload.urgent ? 'high' : 'normal' },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await collection.deleteOne({ _id: subscription._id });
        else console.warn('[push]', status || error);
      }
    }),
  );
}

const myIds = new Map<string, number>();

/**
 * Упоминание или назначение в задаче: портал пишет в комментарий тег [USER=…] с id
 * получателя. Задачи чужих людей событий не шлют, поэтому достаточно сверить id с моим.
 */
export async function pingTaskMention(
  memberId: string,
  event: { type: string; taskId?: string; message?: string; title?: string },
) {
  if (!pushConfigured() || event.type !== 'comment_added' || !event.taskId || !event.message)
    return;
  let me = myIds.get(memberId);
  if (me === undefined) {
    me = Number((await bx24OAuth(memberId, 'user.current', {}, { parallel: true }))?.ID) || 0;
    myIds.set(memberId, me);
  }
  if (!mentionsUser(event.message, me)) return;
  await sendPush(memberId, {
    title: event.title || 'Задача',
    body: bitrixPlainText(event.message).slice(0, 200),
    tag: `task-${event.taskId}`,
    url: `/all-tasks?task=${event.taskId}`,
    urgent: true,
  });
}
