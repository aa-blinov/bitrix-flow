import { describe, expect, it } from 'vitest';
import { extractTaskTags, mongoHashtagMatch } from './task-tags';

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
