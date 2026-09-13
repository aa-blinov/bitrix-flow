// Ссылки и картинки приходят из текста задач Битрикса, то есть от людей.
// React вставляет href как есть, поэтому схему проверяем сами: javascript: и
// data:text/html в ссылке — это выполнение чужого кода на нашем домене.

const SAFE_LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

function scheme(value: string): string | null {
  const match = /^\s*([a-z][a-z0-9+.-]*):/i.exec(value);
  return match ? `${match[1].toLowerCase()}:` : null;
}

/** Ссылка для <a href>: относительные пути и безопасные схемы, иначе никуда. */
export function safeHref(href: string | undefined | null): string | undefined {
  if (!href) return undefined;
  const found = scheme(href);
  if (!found) return href; // относительный путь или якорь
  return SAFE_LINK_SCHEMES.includes(found) ? href : undefined;
}

/** Источник для <img src>: только сеть и data:image. */
export function safeImageSrc(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  const found = scheme(src);
  if (!found) return src;
  if (found === 'http:' || found === 'https:') return src;
  return /^\s*data:image\//i.test(src) ? src : undefined;
}
