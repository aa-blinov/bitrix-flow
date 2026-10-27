// Текст уведомления о сообщении: один для уведомления открытой вкладки и для пуша в закрытую.
import type { MessengerEvent } from './messenger-events';

export function pingText(
  event: Pick<MessengerEvent, 'chat' | 'author' | 'text' | 'mentioned'>,
  labels: { mention: string; message: string },
) {
  const group = Boolean(event.chat) && event.chat !== event.author;
  const title = group ? event.chat : event.author || labels.message;
  const body = group ? `${event.author}: ${event.text}` : event.text;
  return { title, body: event.mentioned ? `${labels.mention} ${body}` : body };
}

/** Тег [USER=12] или служебный [USER=12 REPLACE]: так портал помечает упоминание и назначение. */
export function mentionsUser(text: string, userId: number): boolean {
  return userId > 0 && new RegExp(`\\[USER=${userId}[\\] ]`, 'i').test(text);
}
