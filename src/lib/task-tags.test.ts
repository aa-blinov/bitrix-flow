import { describe, expect, it } from 'vitest';
import { bitrixTaskTags, extractTaskTags, mongoHashtagMatch } from './task-tags';

describe('extractTaskTags', () => {
  it('extracts unique Cyrillic and Latin hashtags from task text', () => {
    expect(
      extractTaskTags('Подготовить #Release_2026', 'Обсудить #маркетинг и #release_2026'),
    ).toEqual(['#Release_2026', '#маркетинг']);
  });

  it('does not mistake URL fragments for a tag', () => {
    expect(extractTaskTags('', 'https://example.com/page#section #реальный-тег')).toEqual([
      '#реальный-тег',
    ]);
  });
});

describe('mongoHashtagMatch', () => {
  it('escapes the tag and refuses a longer neighbour', () => {
    expect(mongoHashtagMatch('#release_2026')).toBe('(*UCP)[\\s([{]#release_2026(?![\\w-])');
    expect(mongoHashtagMatch('a.b')).toContain('a\\.b');
  });
});

describe('bitrixTaskTags', () => {
  it('reads titles out of the id-keyed object Bitrix returns', () => {
    expect(
      bitrixTaskTags({ '197': { id: 197, title: 'P1' }, '249': { title: 'R260916' } }),
    ).toEqual(['P1', 'R260916']);
    expect(bitrixTaskTags(undefined)).toEqual([]);
  });
});
