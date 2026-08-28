import { getBitrixUserUrl } from './utils';

export type BitrixMarkupPart = { text: string; href?: string };
export type BitrixNode =
  | { type: 'text'; text: string }
  | { type: 'link'; href: string; children: BitrixNode[] }
  | { type: 'format'; format: 'b' | 'i' | 'u' | 's'; children: BitrixNode[] }
  | { type: 'quote'; children: BitrixNode[] }
  | { type: 'code'; text: string }
  | { type: 'list'; ordered: boolean; items: BitrixNode[][] }
  | { type: 'image'; src: string };

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTimestamps(text: string) {
  return text.replace(/\[TIMESTAMP=(\d+)\s+FORMAT=([A-Z_]+)\]/gi, (tag, seconds, format) => {
    const date = new Date(Number(seconds) * 1000);
    if (!Number.isFinite(date.getTime())) return tag;
    if (format.toUpperCase() === 'LONG_DATE_FORMAT')
      return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    if (format.toUpperCase() === 'SHORT_TIME_FORMAT')
      return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    return tag;
  });
}

function closingIndex(text: string, tag: string, from: number) {
  const pattern = new RegExp(`\\[(/?)${tag}(?:=[^\\]]+)?\\]`, 'gi');
  pattern.lastIndex = from;
  let depth = 1;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      if (--depth === 0) return { start: match.index!, end: match.index! + match[0].length };
    } else depth++;
  }
}

function parseNodes(text: string): BitrixNode[] {
  const nodes: BitrixNode[] = [];
  const opener = /\[(b|i|u|s|strike|quote|code|url|user|img|list)(?:=([^\]]+))?\]/gi;
  let position = 0;

  for (const match of text.matchAll(opener)) {
    if (match.index! < position) continue;
    if (match.index! > position) nodes.push({ type: 'text', text: text.slice(position, match.index) });
    const tag = match[1].toLowerCase();
    const close = closingIndex(text, tag, match.index! + match[0].length);
    if (!close) {
      nodes.push({ type: 'text', text: match[0] });
      position = match.index! + match[0].length;
      continue;
    }
    const body = text.slice(match.index! + match[0].length, close.start);
    const value = match[2] || '';
    if (tag === 'url' || tag === 'user') {
      const href = tag === 'user' && /^\d+$/.test(value) ? getBitrixUserUrl(value) : safeUrl(value || body);
      nodes.push(href ? { type: 'link', href, children: parseNodes(body) } : { type: 'text', text: body });
    } else if (tag === 'img') {
      const src = safeUrl(body.trim());
      nodes.push(src ? { type: 'image', src } : { type: 'text', text: body });
    } else if (tag === 'code') {
      nodes.push({ type: 'code', text: body });
    } else if (tag === 'list') {
      const items = body.split(/\[\*\]/i).slice(1).map((item) => parseNodes(item.trim()));
      nodes.push(items.length ? { type: 'list', ordered: value === '1', items } : { type: 'text', text: body });
    } else if (tag === 'quote') {
      nodes.push({ type: 'quote', children: parseNodes(body) });
    } else {
      nodes.push({ type: 'format', format: tag === 'strike' ? 's' : tag as 'b' | 'i' | 'u' | 's', children: parseNodes(body) });
    }
    position = close.end;
  }
  if (position < text.length) nodes.push({ type: 'text', text: text.slice(position) });
  return nodes;
}

export function parseBitrixNodes(text: string): BitrixNode[] {
  return parseNodes(normalizeTimestamps(text));
}

export function parseBitrixMarkup(text: string): BitrixMarkupPart[] {
  return parseBitrixNodes(text).flatMap((node) => {
    if (node.type === 'text') return [{ text: node.text }];
    if (node.type === 'link') return [{ text: node.children.map((child) => child.type === 'text' ? child.text : '').join(''), href: node.href }];
    return [{ text: '' }];
  }).filter((part) => part.text);
}

export function formatBitrixDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru-RU', options).format(date);
  return `${part({ hour: '2-digit', minute: '2-digit', hour12: false })} ${part({ day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}
