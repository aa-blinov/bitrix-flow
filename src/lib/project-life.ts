// Лента и календарь проекта: разбор ответов портала без запросов.

export type FeedPost = {
  id: string;
  authorId: string;
  title: string;
  text: string;
  date: string;
  comments: number;
  important: boolean;
};

export function normalizePosts(raw: unknown): FeedPost[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => {
      const text = String(item?.DETAIL_TEXT || '');
      const title = String(item?.TITLE || '');
      return {
        id: String(item?.ID || ''),
        authorId: String(item?.AUTHOR_ID || ''),
        // Микропост без заголовка портал подписывает началом текста: дубль не показываем.
        title: item?.MICRO === 'Y' || text.startsWith(title.replace(/\.\.\.$/, '')) ? '' : title,
        text,
        date: String(item?.DATE_PUBLISH || ''),
        comments: Number(item?.NUM_COMMENTS) || 0,
        important: item?.UF_BLOG_POST_IMPRTNT === '1' || item?.UF_BLOG_POST_IMPRTNT === 1,
      };
    })
    .filter((post) => post.id);
}

export type CalendarEvent = {
  id: string;
  name: string;
  /** Местное время без пояса: 2026-01-19T17:00. */
  from: string;
  to: string;
  allDay: boolean;
  location: string;
};

// Календарь отдаёт даты строкой «19.01.2026 17:00:00» во времени пользователя.
export function portalDateTime(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(value.trim());
  if (!match) return '';
  const [, day, month, year, hours = '00', minutes = '00'] = match;
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function normalizeEvents(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => ({
      id: String(item?.ID || ''),
      name: String(item?.NAME || ''),
      from: portalDateTime(String(item?.DATE_FROM || '')),
      to: portalDateTime(String(item?.DATE_TO || '')),
      allDay: item?.SKIP_TIME === 'Y' || item?.DT_SKIP_TIME === 'Y',
      location: String(item?.LOCATION || ''),
    }))
    .filter((event) => event.id && event.from)
    .sort((a, b) => a.from.localeCompare(b.from));
}
