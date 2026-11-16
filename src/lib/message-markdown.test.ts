import { describe, expect, it } from 'vitest';
import { bitrixPlainText, type BitrixNode } from './bitrix-markup';
import { parseMessageNodes } from './message-markdown';

const kinds = (nodes: BitrixNode[]) =>
  nodes.map((node) => (node.type === 'format' ? `format:${node.format}` : node.type));

describe('message markdown', () => {
  it('reads inline markdown and Bitrix tags in one message', () => {
    const nodes = parseMessageNodes(
      '**жирный** и [B]тоже[/B], `код`, ~~зачёркнуто~~, [сайт](https://a.ru)',
    );
    expect(kinds(nodes)).toEqual([
      'format:b',
      'text',
      'format:b',
      'text',
      'code',
      'text',
      'format:s',
      'text',
      'link',
    ]);
  });

  it('keeps stars and underscores that are not markup', () => {
    expect(bitrixPlainText('2 * 3 * 4 и snake_case_name', parseMessageNodes)).toBe(
      '2 * 3 * 4 и snake_case_name',
    );
    const [link] = parseMessageNodes('https://x.ru/a_b_c.');
    expect(link).toMatchObject({ type: 'link', href: 'https://x.ru/a_b_c' });
  });

  it('does not turn javascript links into anchors', () => {
    const nodes = parseMessageNodes('[клик](javascript:alert(1))');
    expect(kinds(nodes)).not.toContain('link');
  });

  it('reads blocks: fenced code, quote, list, heading', () => {
    const nodes = parseMessageNodes('# Заголовок\n```\nа = 1\n```\n> цитата\n- один\n- два\nконец');
    // Блок кода сам начинается с новой строки: перенос после заголовка перед ним не нужен.
    expect(kinds(nodes)).toEqual(['format:b', 'code', 'quote', 'list', 'text']);
    expect(nodes[1]).toMatchObject({ type: 'code', block: true, text: 'а = 1' });
    expect(nodes[3]).toMatchObject({ type: 'list', ordered: false });
  });

  it('treats a dash after a Bitrix tag as text, not as a list marker', () => {
    const nodes = parseMessageNodes('[USER=1]Анна[/USER] - привет');
    expect(kinds(nodes)).toEqual(['link', 'text']);
  });

  it('links a user written as USER=9 REPLACE', () => {
    expect(kinds(parseMessageNodes('[USER=9 REPLACE]Блинов[/USER] вошёл'))).toEqual([
      'link',
      'text',
    ]);
  });

  it('drops layout-only Bitrix tags and keeps their text', () => {
    expect(bitrixPlainText('[SIZE=20][COLOR=#f00]важно[/COLOR][/SIZE]', parseMessageNodes)).toBe(
      'важно',
    );
  });

  it('keeps a quote whole when it holds Bitrix tags', () => {
    const nodes = parseMessageNodes('>>[USER=5]Анна[/USER]: привет [B]всем[/B] сегодня\nответ');
    expect(kinds(nodes)).toEqual(['quote', 'text']);
    const quote = nodes[0] as Extract<BitrixNode, { type: 'quote' }>;
    expect(kinds(quote.children)).toEqual(['link', 'text', 'format:b', 'text']);
  });

  it('leaves > lines inside a QUOTE tag to the tag itself', () => {
    expect(kinds(parseMessageNodes('[QUOTE]\n> текст\n[/QUOTE]'))).toEqual(['quote']);
  });

  it('keeps Bitrix tags inside a fenced code block as code text', () => {
    const nodes = parseMessageNodes('до\n```\n[B]важно[/B]\n```\nпосле');
    expect(kinds(nodes)).toEqual(['text', 'code', 'text']);
    expect(nodes[1]).toMatchObject({ type: 'code', block: true, text: '[B]важно[/B]' });
  });

  it('keeps a bold tag spanning lines around a > line paired', () => {
    expect(kinds(parseMessageNodes('[B]\n> текст\n[/B]'))).toEqual(['format:b']);
  });

  it('caps quote nesting so hundreds of > do not blow the stack', () => {
    let depth = 0;
    let nodes = parseMessageNodes('>'.repeat(4000) + ' текст');
    while (nodes[0]?.type === 'quote') {
      depth += 1;
      nodes = nodes[0].children;
    }
    expect(depth).toBeLessThanOrEqual(9);
  });

  it('caps Bitrix tag nesting so hundreds of QUOTE tags do not blow the stack', () => {
    const deep = '[QUOTE]'.repeat(3000) + 'текст' + '[/QUOTE]'.repeat(3000);
    expect(() => parseMessageNodes(deep)).not.toThrow();
  });

  it('keeps an unclosed fence line as text instead of dropping it', () => {
    expect(bitrixPlainText('```javascript\nconst a = 1', parseMessageNodes)).toContain(
      '```javascript',
    );
  });

  it('treats a literal [CODE] inside a CODE block as text', () => {
    const nodes = parseMessageNodes('[CODE]пример [CODE] здесь[/CODE]');
    expect(nodes[0]).toMatchObject({ type: 'code', text: 'пример [CODE] здесь' });
  });

  it('does not let a closing tag inside CODE close the outer quote', () => {
    const nodes = parseMessageNodes('[QUOTE][CODE]пример [/QUOTE] здесь[/CODE] конец[/QUOTE]');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'quote' });
  });

  it('masks short CODE bodies without touching the tag itself', () => {
    expect(parseMessageNodes('[B][CODE]c[/CODE][/B]')[0]).toMatchObject({ type: 'format' });
  });

  it('keeps everything after an unclosed fence literal', () => {
    expect(kinds(parseMessageNodes('```\n> текст [B]x[/B]'))).toEqual(['text']);
  });

  it('a stray closing tag before a pair does not cancel it', () => {
    const nodes = parseMessageNodes('[/B]\n[B]текст\n> цитата\n[/B]');
    expect(kinds(nodes).filter((k) => k === 'format:b')).toHaveLength(1);
  });

  it('keeps a nested LIST inside its item', () => {
    const [list] = parseMessageNodes('[LIST][*]Первый[LIST][*]Вложенный[/LIST][*]Второй[/LIST]');
    expect(list).toMatchObject({ type: 'list' });
    const items = (list as Extract<BitrixNode, { type: 'list' }>).items;
    expect(items).toHaveLength(2);
    expect(kinds(items[0])).toContain('list');
  });

  it('leaves > lines inside a fenced code block as code', () => {
    expect(kinds(parseMessageNodes('```\n> не цитата\n```'))).toEqual(['code']);
  });
});
