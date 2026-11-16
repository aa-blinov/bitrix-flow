import { parseBitrixNodes, safeUrl, type BitrixNode } from './bitrix-markup';

// В чат пишут и в разметке Битрикса ([B], [URL]), и обычным Markdown: так
// пишут боты, мосты из других мессенджеров и люди, привыкшие к Markdown.
// Сначала разбираем теги Битрикса, потом в оставшемся тексте ищем Markdown.
// Поддерживаем то, что встречается в переписке: блоки кода, цитаты, списки,
// заголовки и инлайн-стили. Таблиц и вложенных списков нет.

// Инлайн-образцы по приоритету: код не разбирается внутри себя, ссылка с
// подписью раньше голого адреса. Разделители не должны касаться пробела
// изнутри, иначе «2 * 3 * 4» стало бы курсивом.
const INLINE = new RegExp(
  [
    '`([^`\\n]+)`',
    '\\*\\*(?!\\s)([^\\n]+?)(?<!\\s)\\*\\*',
    '__(?!\\s)([^\\n]+?)(?<!\\s)__',
    '~~(?!\\s)([^\\n]+?)(?<!\\s)~~',
    '\\[([^\\]\\n]+)\\]\\((https?://[^)\\s]+)\\)',
    '(?<![\\w*])\\*(?![\\s*])([^*\\n]+?)(?<![\\s*])\\*(?![\\w*])',
    '(?<![\\w_])_(?![\\s_])([^_\\n]+?)(?<![\\s_])_(?![\\w_])',
    '(https?://[^\\s<>\\[\\]]+)',
  ].join('|'),
  'g',
);

const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

function inline(text: string): BitrixNode[] {
  const nodes: BitrixNode[] = [];
  let position = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, code, bold, bold2, strike, label, href, italic, italic2, bare] = match;
    if (match.index > position)
      nodes.push({ type: 'text', text: text.slice(position, match.index) });
    position = match.index + whole.length;
    if (code !== undefined) nodes.push({ type: 'code', text: code });
    else if (bold !== undefined || bold2 !== undefined)
      nodes.push({ type: 'format', format: 'b', children: inline(bold ?? bold2) });
    else if (strike !== undefined)
      nodes.push({ type: 'format', format: 's', children: inline(strike) });
    else if (label !== undefined) {
      const safe = safeUrl(href);
      if (safe) nodes.push({ type: 'link', href: safe, children: inline(label) });
      else nodes.push({ type: 'text', text: whole });
    } else if (italic !== undefined || italic2 !== undefined)
      nodes.push({ type: 'format', format: 'i', children: inline(italic ?? italic2) });
    else {
      // Знак препинания в конце адреса это конец предложения, а не часть ссылки.
      const tail = TRAILING_PUNCTUATION.exec(bare)?.[0] ?? '';
      const url = safeUrl(bare.slice(0, bare.length - tail.length));
      if (url) nodes.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
      else nodes.push({ type: 'text', text: bare.slice(0, bare.length - tail.length) });
      position -= tail.length;
    }
  }
  if (position < text.length) nodes.push({ type: 'text', text: text.slice(position) });
  return nodes;
}

const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.+)$/;

// atLineStart: первая строка узла стоит в начале строки сообщения. Узел после
// тега ([USER=1]Имя[/USER] - привет) начинается посреди строки, и дефис в нём
// это не маркер списка.
// Глубже этого цитаты не вкладываем: строка из сотен «>» иначе давала бы столько же
// уровней рекурсии и вложенных блоков, и разбор или рендер переполнял бы стек.
const MAX_QUOTE_DEPTH = 8;

export function markdownNodes(text: string, atLineStart = true, depth = 0): BitrixNode[] {
  const lines = text.split('\n');
  const out: BitrixNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(...inline(paragraph.join('\n')));
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const blockAllowed = atLineStart || i > 0;
    // Блок кода только с закрывающей строкой: без неё открывающая строка и остальное
    // остаются текстом, а не пропадают.
    const fenceEnd = line.startsWith('```')
      ? lines.findIndex((next, j) => j > i && next.startsWith('```'))
      : -1;
    if (blockAllowed && fenceEnd > i) {
      flush();
      out.push({ type: 'code', text: lines.slice(i + 1, fenceEnd).join('\n'), block: true });
      i = fenceEnd;
      continue;
    }
    if (blockAllowed && line.startsWith('>') && depth < MAX_QUOTE_DEPTH) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++)
        // >> это родная цитата чата Битрикса, > привычная markdown-форма.
        body.push(lines[i].replace(/^>>?\s?/, ''));
      i--;
      out.push({ type: 'quote', children: markdownNodes(body.join('\n'), true, depth + 1) });
      continue;
    }
    const marker = !blockAllowed
      ? null
      : BULLET.test(line)
        ? BULLET
        : ORDERED.test(line)
          ? ORDERED
          : null;
    if (marker) {
      flush();
      const items: BitrixNode[][] = [];
      for (; i < lines.length && marker.test(lines[i]); i++)
        items.push(inline(marker.exec(lines[i])![1]));
      i--;
      out.push({ type: 'list', ordered: marker === ORDERED, items });
      continue;
    }
    const heading = blockAllowed ? HEADING.exec(line) : null;
    if (heading) {
      flush();
      out.push({ type: 'format', format: 'b', children: inline(heading[1]) });
      // Строка заголовка занимает блок целиком: перенос после неё остаётся в тексте.
      if (i < lines.length - 1) out.push({ type: 'text', text: '\n' });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out;
}

// Блоки (цитата, список, код) сами занимают строку, поэтому перенос, который
// шёл сразу за ними, лишний: иначе между блоком и текстом выходит пустая строка.
function trimBlockBreaks(nodes: BitrixNode[]): BitrixNode[] {
  return nodes.map((node, index) => {
    const previous = nodes[index - 1];
    if (
      node.type === 'text' &&
      previous &&
      (previous.type === 'quote' ||
        previous.type === 'list' ||
        (previous.type === 'code' && previous.block))
    )
      return { ...node, text: node.text.replace(/^\n/, '') };
    return node;
  });
}

function withMarkdown(nodes: BitrixNode[], top: boolean, depth = 0): BitrixNode[] {
  return trimBlockBreaks(
    nodes.flatMap((node, index): BitrixNode[] => {
      if (node.type === 'text') return markdownNodes(node.text, top && index === 0, depth);
      // Внутри ссылки Markdown не ищем: вложенная ссылка в <a> недопустима.
      if (node.type === 'format' || node.type === 'quote')
        return [{ ...node, children: withMarkdown(node.children, false, depth) }];
      return [node];
    }),
  );
}

const PAIRED_TAG =
  /\[(\/?)(b|i|u|s|strike|quote|code|url|user|img|list|chat|size|color|font|send|put|call|context)(?:=[^\]]*)?\]/gi;

// Строка > внутри парного тега ([QUOTE], [CODE], [B] на несколько строк): её разберёт
// сам тег, иначе открывающий и закрывающий попали бы в разные куски и остались без пары.
// Состояние копится по строкам: пересчёт всего накопленного текста на каждой строке
// делал разбор длинного сообщения квадратичным.
function tagTracker() {
  const open = new Map<string, number>();
  // Внутри [CODE] всё текст: теги в нём не открывают и не закрывают разметку.
  let inCode = false;
  return {
    feed(line: string) {
      for (const [, close, tag] of line.matchAll(PAIRED_TAG)) {
        const name = tag.toLowerCase();
        if (inCode) {
          if (close && name === 'code') inCode = false;
          continue;
        }
        if (name === 'code' && !close) {
          inCode = true;
          continue;
        }
        // По порядку: лишний закрывающий тег раньше пары её не гасит.
        const depth = open.get(name) || 0;
        if (!close) open.set(name, depth + 1);
        else if (depth) open.set(name, depth - 1);
      }
    },
    isOpen: () => inCode || [...open.values()].some((depth) => depth > 0),
  };
}

// Цитата строками > собирается до разбора тегов: в ней бывают [USER] и [B], и разбор
// тегов первым резал её на куски, после которых цитатой оставалась только первая часть.
// Внутри блока кода строки с > это код, а не цитата.
export function parseMessageNodes(text: string, depth = 0): BitrixNode[] {
  const lines = text.split('\n');
  const out: BitrixNode[] = [];
  let rest: string[] = [];
  let tags = tagTracker();
  const flush = () => {
    if (rest.length) out.push(...withMarkdown(parseBitrixNodes(rest.join('\n')), true, depth));
    rest = [];
    tags = tagTracker();
  };
  for (let i = 0; i < lines.length; i++) {
    // Блок кода ```…``` берём целиком до разбора тегов: [B] в коде это текст кода.
    if (lines[i].startsWith('```') && !tags.isOpen()) {
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !lines[j].startsWith('```'); j++) body.push(lines[j]);
      if (j < lines.length) {
        flush();
        out.push({ type: 'code', text: body.join('\n'), block: true });
        i = j;
        continue;
      }
      // Незакрытый блок: дальше всё буквально, без цитат и тегов. Перенос перед ним
      // сохраняем, иначе ``` прилипло бы к предыдущей строке.
      const before = out.length > 0 || rest.length > 0;
      flush();
      out.push({ type: 'text', text: (before ? '\n' : '') + lines.slice(i).join('\n') });
      return out;
    }
    if (depth >= MAX_QUOTE_DEPTH || !lines[i].startsWith('>') || tags.isOpen()) {
      rest.push(lines[i]);
      tags.feed(lines[i]);
      continue;
    }
    const body: string[] = [];
    for (; i < lines.length && lines[i].startsWith('>'); i++)
      // >> это родная цитата чата Битрикса, > привычная markdown-форма.
      body.push(lines[i].replace(/^>>?\s?/, ''));
    i--;
    flush();
    out.push({ type: 'quote', children: parseMessageNodes(body.join('\n'), depth + 1) });
  }
  flush();
  return out;
}
