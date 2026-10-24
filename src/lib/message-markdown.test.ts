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
    expect(kinds(nodes)).toEqual(['format:b', 'text', 'code', 'quote', 'list', 'text']);
    expect(nodes[2]).toMatchObject({ type: 'code', block: true, text: 'а = 1' });
    expect(nodes[4]).toMatchObject({ type: 'list', ordered: false });
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
});
