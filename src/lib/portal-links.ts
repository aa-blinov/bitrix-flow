// Ссылки на объекты Битрикса в чатах, задачах и комментариях: задачу, которую
// скинули в чат, надо открывать в BitrixFlow, а не уводить человека на портал.
// Адрес портала приложению известен только серверу, поэтому узнаём портал по
// домену Битрикс24 и по привычному виду пути.
const PORTAL_HOST = /\.bitrix24\.[a-z.]+$/i;
const TASK_PATH = /\/tasks\/task\/view\/(\d+)\/?/;
const GROUP_PATH = /\/workgroups\/group\/(\d+)\/?$/;

/** Адрес внутри BitrixFlow или null, если ссылка на что-то другое. */
export function internalHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!PORTAL_HOST.test(url.hostname)) return null;
  const task = TASK_PATH.exec(url.pathname);
  if (task) return `/all-tasks?task=${task[1]}`;
  const group = GROUP_PATH.exec(url.pathname);
  if (group) return `/projects/${group[1]}`;
  return null;
}

/** Короткая подпись для ссылки, у которой в тексте стоит сам длинный адрес портала. */
export function internalLabel(path: string): string {
  const task = /^\/all-tasks\?task=(\d+)$/.exec(path);
  if (task) return `Задача #${task[1]}`;
  const group = /^\/projects\/(\d+)$/.exec(path);
  return group ? `Проект #${group[1]}` : path;
}
