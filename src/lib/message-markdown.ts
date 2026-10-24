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
export function markdownNodes(text: string, atLineStart = true): BitrixNode[] {
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
    if (blockAllowed && line.startsWith('```')) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      out.push({ type: 'code', text: body.join('\n'), block: true });
      continue;
    }
    if (blockAllowed && line.startsWith('>')) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++)
        body.push(lines[i].replace(/^>\s?/, ''));
      i--;
      out.push({ type: 'quote', children: markdownNodes(body.join('\n')) });
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

function withMarkdown(nodes: BitrixNode[], top: boolean): BitrixNode[] {
  return trimBlockBreaks(
    nodes.flatMap((node, index): BitrixNode[] => {
      if (node.type === 'text') return markdownNodes(node.text, top && index === 0);
      // Внутри ссылки Markdown не ищем: вложенная ссылка в <a> недопустима.
      if (node.type === 'format' || node.type === 'quote')
        return [{ ...node, children: withMarkdown(node.children, false) }];
      return [node];
    }),
  );
}

export function parseMessageNodes(text: string): BitrixNode[] {
  return withMarkdown(parseBitrixNodes(text), true);
}
