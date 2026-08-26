export type BitrixMarkupPart = { text: string; href?: string };

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseBitrixMarkup(text: string): BitrixMarkupPart[] {
  const parts: BitrixMarkupPart[] = [];
  const pattern = /\[url(?:=([^\]]+))?\]([\s\S]*?)\[\/url\]/gi;
  let position = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index! > position) parts.push({ text: text.slice(position, match.index) });
    const label = match[2];
    const href = safeUrl(match[1] || label);
    parts.push(href ? { text: label, href } : { text: label });
    position = match.index! + match[0].length;
  }

  if (position < text.length) parts.push({ text: text.slice(position) });
  return parts;
}

export function formatBitrixDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ru-RU', options).format(date);

  return `${part({ hour: '2-digit', minute: '2-digit', hour12: false })} ${part({ day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}
